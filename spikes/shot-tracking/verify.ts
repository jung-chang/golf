// Run from repository root: pnpm exec tsx spikes/shot-tracking/verify.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestFix } from '../../src/play/useGeolocation';
import { defaultBag, suggestClub, trackedShots } from '../../src/lib/clubs';
import { newRound, markShot, holeDone } from '../../src/lib/round';
import { M_TO_YD, offset, type LngLat } from '../../src/lib/geo';
import { appendAction, fixUsable, greenView, measureShot, recommend, shotLedger, validRange, type LocationSample, type ShotAction, type StockClub } from './model';
import type { Course } from '../../src/schemas/course';

const pos: LngLat = [-73.788437, 40.783334];
const now = 1_000_000;
const fix: LocationSample = { pos, accuracyM: 2, acquiredAt: now };
const stock: StockClub[] = [
  { id: '7i', name: '7 Iron', full: { low: 145, high: 160 }, chip: null, enabled: true },
  { id: '8i', name: '8 Iron', full: { low: 130, high: 145 }, chip: { low: 15, high: 30 }, enabled: true },
  { id: 'sw', name: 'SW', full: { low: 75, high: 90 }, chip: { low: 10, high: 25 }, enabled: true },
];
let checks = 0;
function check(label: string, run: () => void) { run(); checks++; console.log(`PASS ${label}`); }

check('invalid range input rejected', () => {
  for (const r of [{ low: 160, high: 145 }, { low: 0, high: 10 }, { low: NaN, high: 10 }, { low: 1, high: Infinity }]) assert.equal(validRange(r), false);
});
check('150 yd uses 7i 145–160', () => assert.equal(recommend(150, stock, fix, now, 'full').primary?.club.id, '7i'));
check('disabled clubs never enter recommendations', () => {
  const result = recommend(150, stock.map(c => c.id === '7i' ? { ...c, enabled: false } : c), fix, now, 'full');
  assert.equal(result.primary, null); assert.equal(result.alternatives.some(c => c.club.id === '7i'), false);
});
check('GPS uncertainty exposes adjacent plausible clubs', () => {
  const r = recommend(144, stock, fix, now, 'full');
  assert.equal(r.primary?.club.id, '8i'); assert.equal(r.alternatives[0]?.club.id, '7i');
});
check('range gaps do not get false precision', () => assert.equal(recommend(110, stock, fix, now, 'full').status, 'outside-ranges'));
check('400 yd does not get an insufficient longest club', () => assert.equal(recommend(400, stock, fix, now, 'full').primary, null));
check('20 yd chip uses chip stock, not full LW', () => {
  const r = recommend(20, stock, fix, now, 'chip');
  assert.equal(r.primary?.club.id, 'sw'); assert.deepEqual(r.primary?.range, { low: 10, high: 25 });
});
check('missing chip stock asks for manual choice', () => assert.equal(recommend(20, stock.map(c => ({ ...c, chip: null })), fix, now, 'chip').status, 'no-stock-range'));
check('bad and expired fixes suppress recommendations', () => {
  for (const f of [{ ...fix, acquiredAt: now - 9000 }, { ...fix, acquiredAt: now + 1 }, { ...fix, accuracyM: NaN }, { ...fix, pos: [999, 40] as LngLat }]) assert.equal(fixUsable(f, now, 'full'), false);
  assert.equal(recommend(20, stock, { ...fix, accuracyM: 7 }, now, 'chip').status, 'needs-location');
});
check('green camera hysteresis and override', () => {
  assert.equal(greenView(59, 'course', true), 'green'); assert.equal(greenView(65, 'green', true), 'green');
  assert.equal(greenView(91, 'green', true), 'course'); assert.equal(greenView(20, 'course', false), 'course');
  assert.equal(greenView(20, 'course', true, 'course'), 'course');
});
check('measured distances retain intent and uncertainty; estimated endpoints excluded', () => {
  const start = { ...fix, acquiredAt: now - 180_000, markedAt: now - 180_000 };
  const end = { ...fix, pos: offset(pos, 0, 150 / M_TO_YD) };
  const m = measureShot(start, end, now, 'full', 'measured');
  assert.ok(m.yards != null && Math.abs(m.yards - 150) < 0.01); assert.ok(m.envelope && m.envelope.low < 150 && m.envelope.high > 150);
  assert.equal(m.usableForStats, true);
  assert.equal(measureShot(start, end, now, 'full', 'estimated-pin').usableForStats, false);
  assert.equal(measureShot({ ...start, markedAt: start.acquiredAt + 9000 }, end, now, 'full', 'measured').usableForStats, false);
  assert.equal(measureShot(start, { ...end, acquiredAt: now - 9000 }, now, 'full', 'measured').usableForStats, false);
  assert.equal(measureShot(start, { ...end, pos: offset(pos, 0, 10 / M_TO_YD), accuracyM: 3 }, now, 'chip', 'measured').usableForStats, false);
});

check('zero-length, tiny uncertain, invalid, and mishit samples cannot enter statistics', () => {
  const start = { ...fix, accuracyM: 0, markedAt: now };
  assert.equal(measureShot(start, { ...fix, accuracyM: 0 }, now, 'full', 'measured').usableForStats, false);
  const tiny = { ...fix, accuracyM: 0.5, pos: offset(pos, 0, 1 / M_TO_YD) };
  assert.equal(measureShot({ ...start, accuracyM: 0.5 }, tiny, now, 'chip', 'measured').usableForStats, false);
  const bad = measureShot(start, { ...fix, pos: [200, 40] }, now, 'full', 'measured');
  assert.equal(bad.yards, null); assert.equal(bad.envelope, null); assert.equal(bad.usableForStats, false);
  assert.equal(measureShot(start, { ...fix, pos: offset(pos, 0, 150 / M_TO_YD) }, now, 'full', 'measured', true).usableForStats, false);
});

const action = (type: 'shot' | 'putt', yards: number, time: number, club = type === 'putt' ? 'pt' : '7i'): ShotAction => ({
  type, club, intent: 'full', fix: { pos: offset(pos, 0, yards / M_TO_YD), accuracyM: 2, acquiredAt: time, markedAt: time },
});
check('the first putt finishes the previous shot exactly once', () => {
  const actions = [action('shot', 0, now), action('putt', 150, now + 60_000), action('putt', 152, now + 80_000)];
  const ledger = shotLedger(actions);
  assert.equal(ledger.shots, 1); assert.equal(ledger.putts, 2); assert.equal(ledger.completed.length, 1); assert.equal(ledger.pending, null);
  assert.ok(Math.abs(ledger.completed[0].measurement.yards! - 150) < 0.01);
  assert.equal(ledger.completed[0].measurement.usableForStats, true);
});
check('undo restores open endpoints and does not lose the prior measurement', () => {
  const actions = [action('shot', 0, now), action('shot', 150, now + 60_000), action('putt', 170, now + 90_000)];
  assert.equal(shotLedger(actions).completed.length, 2);
  const undoPutt = shotLedger(actions.slice(0, -1));
  assert.equal(undoPutt.completed.length, 1); assert.equal(undoPutt.pending?.index, 2);
  const undoShot = shotLedger(actions.slice(0, 1));
  assert.equal(undoShot.completed.length, 0); assert.equal(undoShot.pending?.index, 1);
});
check('weak endpoint quality stays excluded after later actions and undo', () => {
  const weak = action('putt', 150, now + 60_000); weak.fix.accuracyM = 20;
  const actions = [action('shot', 0, now), weak, action('putt', 152, now + 90_000)];
  assert.equal(shotLedger(actions).completed[0].measurement.usableForStats, false);
  assert.equal(shotLedger(actions.slice(0, -1)).completed[0].measurement.usableForStats, false);
});
check('double taps do not add a second shot; intentional putt taps still count', () => {
  const first = action('shot', 0, now);
  assert.equal(appendAction([first], action('shot', 0, now + 100)).duplicate, true);
  assert.equal(appendAction([first], action('shot', 0, now + 1_500)).actions.length, 2);
  const putt = action('putt', 150, now + 60_000);
  assert.equal(appendAction([putt], action('putt', 150, now + 60_100)).actions.length, 2);
});

// Reproduce existing behavior; no production fixes are applied by this spike.
check('current bestFix returns expired latest sample', () => {
  assert.ok(bestFix([{ pos, acc: 2, t: now - 30_000 }], now));
  assert.equal(fixUsable({ ...fix, acquiredAt: now - 30_000 }, now, 'full'), false);
});
check('current scalar suggestion gives full LW at 20 yd', () => assert.equal(suggestClub(20, defaultBag(), {})?.club.id, 'lw'));
check('current estimated-pin endpoint enters tracked stock', () => {
  const c = JSON.parse(readFileSync('courses/clearview-park.json', 'utf8')) as Course;
  const r = markShot(newRound(c, c.tees[0].id), 'sw', pos, 2);
  assert.equal(trackedShots([holeDone(r, offset(pos, 0, 20 / M_TO_YD))]).length, 1);
});
console.log(`\n${checks} spike checks passed. Thresholds still need real-phone field validation.`);
