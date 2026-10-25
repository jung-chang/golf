import { describe, expect, it, vi, afterEach } from 'vitest';
import courseJson from '../courses/clearview-park.json';
import { Course } from '../src/schemas/course';
import { Round, type HoleState } from '../src/schemas/round';
import { defaultBag, trackedShots } from '../src/lib/clubs';
import { M_TO_YD, offset } from '../src/lib/geo';
import { emptyHole, holeScore, newRound } from '../src/lib/round';
import * as T from '../src/lib/tracking';

const course = Course.parse(courseJson), hole = course.holes[0], tee = hole.tees!.white.pos;
const fairway = offset(tee, 180, 200), green = hole.green.center;
const fix = (pos = tee, t = 100000, acc = 3) => ({ pos, t, acc });
const base = () => newRound(course, 'white');
const completeShot = () => T.saveTrackedShot(T.startTrackedShot(base(), 'dr', fix()), fix(fairway));
afterEach(() => vi.restoreAllMocks());

describe('explicit shot ledger', () => {
  it('persists a pending shot through schema reload without counting it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const started = Round.parse(JSON.parse(JSON.stringify(T.startTrackedShot(base(), 'dr', fix()))));
    expect(started.holes[1].pendingShot).toMatchObject({ club: 'dr', pos: tee });
    expect(holeScore(started.holes[1])).toBe(0);
    const saved = T.saveTrackedShot(started, fix(fairway));
    expect(saved.holes[1].pendingShot).toBeUndefined();
    expect(saved.holes[1].shots).toHaveLength(1);
    expect(saved.holes[1].shots[0]).toMatchObject({ pos: tee, end: fairway, endAcc: 3, endT: 100000 });
    expect(T.saveTrackedShot(saved, fix(green))).toBe(saved);
  });
  it('never changes a previous endpoint when starting, changing clubs, or saving', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const old = completeShot(), before = structuredClone(old.holes[1].shots[0]);
    let r = T.startTrackedShot(old, '7i', fix(offset(fairway, 90, 15)));
    r = T.changeTrackedClub(r, 'pw');
    r = T.saveTrackedShot(r, fix(green));
    expect(r.holes[1].shots[0]).toEqual(before);
    expect(r.holes[1].shots[1].club).toBe('pw');
  });
  it('counts unknown positions without manufacturing GPS or distances', () => {
    const r = T.saveTrackedShot(T.startTrackedShot(base(), 'dr', null), null);
    expect(r.holes[1].shots[0]).toMatchObject({ pos: null, end: null, origin: 'manual' });
    expect(holeScore(r.holes[1])).toBe(1);
    expect(Round.parse(r).holes[1].shots).toHaveLength(1);
    expect(trackedShots([r])).toEqual([]);
  });
  it('finishing with 0 or 6 putts leaves chip endpoints intact', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const r = completeShot();
    for (const n of [0, 6, 12]) {
      const finished = T.completeTrackedHole(r, n);
      expect(finished.holes[1].shots).toEqual(r.holes[1].shots);
      expect(finished.holes[1]).toMatchObject({ completed: true, putts: n });
      expect(holeScore(finished.holes[1])).toBe(n + 1);
    }
    expect(() => T.completeTrackedHole(r, -1)).toThrow();
    expect(() => T.completeTrackedHole(r, 1.5)).toThrow();
    expect(() => T.completeTrackedHole(T.startTrackedShot(base(), 'sw', null), 2)).toThrow();
  });
  it('excludes recovered, manually placed, short, noisy, and incomplete measurements from learning', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const r = completeShot(), s = r.holes[1].shots[0];
    expect(trackedShots([r])).toHaveLength(1);
    for (const patch of [{ origin: 'manual' as const }, { origin: 'recovered' as const }, { endAcc: 30 },
      { end: offset(tee, 180, 10) }, { end: null }, { pos: null }]) {
      expect(trackedShots([{ ...r, holes: { 1: { ...r.holes[1], shots: [{ ...s, ...patch }] } } }])).toEqual([]);
    }
  });
});
describe('GPS recovery', () => {
  it('suggests the configured club from displacement, without writing anything', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const r = completeShot(), h = r.holes[1], original = structuredClone(h);
    const f = fix(offset(fairway, 180, 98 / M_TO_YD));
    const suggestion = T.suggestRecovery(h, hole, 'white', f, defaultBag(), 3000)!;
    expect(suggestion).toMatchObject({ club: 'sw', source: 'last-finish', yards: 98 });
    expect(h).toEqual(original);
    const added = T.addRecoveredShot(r, suggestion, hole);
    expect(added.holes[1].shots).toHaveLength(2);
    expect(added.holes[1].shots[0]).toEqual(original.shots[0]);
    expect(added.holes[1].shots[1]).toMatchObject({ pos: fairway, end: f.pos, origin: 'recovered' });
    expect(T.addRecoveredShot(added, suggestion, hole)).toBe(added);
  });
  it('uses the selected tee only for the first shot and never replaces an unknown finish with a tee', () => {
    const black = { ...hole, tees: { ...hole.tees, black: { pos: offset(tee, 0, 20) } } };
    expect(T.recoveryStart(emptyHole(), black, 'black').start).toEqual(black.tees.black.pos);
    expect(T.recoveryStart(emptyHole(), { ...hole, tees: undefined }, 'white').start).toBeNull();
    const h = { ...emptyHole(), shots: [{ id: 'x', club: 'dr', pos: tee, end: null, acc: 3, t: 1, mishit: false }] };
    expect(T.recoveryStart(h, hole, 'white').start).toBeNull();
  });
  it('suppresses jitter, stale/weak/future GPS, movement, missing quality, disabled clubs, and pending shots', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const h = completeShot().holes[1], bag = defaultBag(), far = offset(fairway, 180, 90);
    for (const f of [fix(far, 90000), fix(far, 100001), fix(far, 100000, 30), fix(offset(fairway, 90, 4))]) expect(T.suggestRecovery(h, hole, 'white', f, bag, 3000)).toBeNull();
    expect(T.suggestRecovery(h, hole, 'white', fix(far), bag, 1000)).toBeNull();
    expect(T.suggestRecovery({ ...h, pendingShot: h.shots[0] }, hole, 'white', fix(far), bag, 3000)).toBeNull();
    expect(T.suggestRecovery({ ...h, shots: [{ ...h.shots[0], endAcc: null }] }, hole, 'white', fix(far), bag, 3000)).toBeNull();
    expect(T.suggestRecovery(h, hole, 'white', fix(far), { ...bag, clubs: bag.clubs.map(c => ({ ...c, on: false })) }, 3000)).toBeNull();
  });
});
describe('editing saved holes', () => {
  it('retains older imported shots and putts when their empty log is first edited', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const old = { ...completeShot().holes[1], log: [], putts: 6, penalties: 1 };
    const edited = T.insertEditedShot(old, 1, 0, 'pw');
    expect(edited.log.filter(op => op === 'shot')).toHaveLength(2);
    expect(edited.log.filter(op => op === 'putt')).toHaveLength(6);
    expect(edited.log.filter(op => op === 'pen')).toHaveLength(1);
  });
  it('inserts/deletes a middle stroke without rewiring neighbors, penalties, or putts', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    let r = completeShot(); r = T.saveTrackedShot(T.startTrackedShot(r, 'pw', fix(fairway)), fix(green)); r = T.completeTrackedHole(r, 6);
    const h = { ...r.holes[1], penalties: 1, log: ['shot', 'pen', 'shot', ...Array.from({ length: 6 }, () => 'putt')] as HoleState['log'] };
    const n = T.insertEditedShot(h, 1, 1, '7i');
    expect(n.shots[0]).toEqual(h.shots[0]); expect(n.shots[2]).toEqual(h.shots[1]);
    expect(n.log.filter(op => op === 'shot')).toHaveLength(3);
    expect(n.putts).toBe(6); expect(n.penalties).toBe(1); expect(n.completed).toBe(true);
    expect(T.deleteEditedShot(n, n.shots[1].id!).shots).toEqual(h.shots);
  });
  it('preserves active hole and finished-round state and rejects a concurrent edit', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100000);
    const r = { ...completeShot(), current: 8, done: true }, expected = r.holes[1];
    const draft = T.prepareHole(expected, 1); draft.shots[0].club = '3w';
    const saved = T.commitHoleEdit(r, 1, expected, draft);
    expect(saved.current).toBe(8); expect(saved.done).toBe(true);
    expect(() => T.commitHoleEdit({ ...r, holes: { 1: { ...expected, penalties: 1 } } }, 1, expected, draft)).toThrow('changed');
  });
});
