import type { Bag, HoleState, Round, Shot } from '../schemas/round';
import type { Hole } from '../schemas/course';
import { distYd, M_TO_YD, type LngLat } from './geo';
import { editHole, emptyHole } from './round';
import { PUTTER } from './clubs';

export type ShotFix = { pos: LngLat; acc: number; t: number };
export const validFix = (fix: ShotFix | null, now = Date.now(), maxAccuracy = 8): fix is ShotFix => !!fix
  && Number.isFinite(fix.acc) && fix.acc >= 0 && fix.acc <= maxAccuracy
  && Number.isFinite(fix.t) && now >= fix.t && now - fix.t <= 8_000
  && fix.pos.every(Number.isFinite) && Math.abs(fix.pos[0]) <= 180 && Math.abs(fix.pos[1]) <= 90;

export const shotId = (s: Shot, index: number, holeNo: number) => s.id ?? `legacy-${holeNo}-${index}-${s.t}`;
export function prepareHole(h: HoleState, holeNo: number): HoleState {
  const n = structuredClone(h);
  n.trackingVersion = 2;
  n.shots.forEach((s, i) => { s.id = shotId(s, i, holeNo); });
  // Older imports may have score records without an operation log. Populate it
  // before adding/editing a stroke so replay doesn't lose those existing records.
  if (!n.log.length) n.log = [...n.shots.map(() => 'shot' as const),
    ...Array.from({ length: n.putts }, () => 'putt' as const),
    ...Array.from({ length: n.penalties }, () => 'pen' as const)];
  return n;
}
const operate = (r: Round, change: (h: HoleState) => void, holeNo = r.current) => editHole(r, h => {
  Object.assign(h, prepareHole(h, holeNo)); change(h);
}, holeNo);

export function startTrackedShot(r: Round, club: string, fix: ShotFix | null): Round {
  const h = r.holes[r.current];
  if (h?.pendingShot || h?.completed || r.done || club === PUTTER) return r;
  return operate(r, h => {
    const saved = h.correction;
    const f = validFix(fix) ? fix : null;
    h.pendingShot = { id: crypto.randomUUID(), club, pos: saved?.pos ?? f?.pos ?? null, end: null,
      acc: saved?.acc ?? f?.acc ?? 0, t: saved?.t ?? f?.t ?? Date.now(), mishit: saved?.mishit ?? false,
      origin: saved ? 'manual' : f ? 'gps' : 'manual', startSource: saved ? 'manual' : f ? 'gps' : 'unknown' };
    delete h.correction;
  });
}
export function changeTrackedClub(r: Round, club: string): Round {
  if (!r.holes[r.current]?.pendingShot || club === PUTTER) return r;
  return operate(r, h => { h.pendingShot!.club = club; });
}
export function cancelTrackedShot(r: Round): Round {
  if (!r.holes[r.current]?.pendingShot) return r;
  return operate(r, h => { delete h.pendingShot; });
}
export function saveTrackedShot(r: Round, fix: ShotFix | null, pendingId?: string): Round {
  const pending = r.holes[r.current]?.pendingShot;
  if (!pending || (pendingId && pending.id !== pendingId)) return r;
  return operate(r, h => {
    const f = validFix(fix) ? fix : null;
    const s = h.pendingShot!;
    h.shots.push({ ...s, end: f?.pos ?? null, endAcc: f?.acc ?? null, endT: f?.t,
      origin: s.origin === 'gps' && f ? 'gps' : 'manual' });
    delete h.pendingShot;
    h.log.push('shot');
  });
}
export function completeTrackedHole(r: Round, n: number, holeNo = r.current): Round {
  if (!Number.isSafeInteger(n) || n < 0 || n > 999) throw new Error('Enter a whole putt count from 0 to 999.');
  if (r.holes[holeNo]?.pendingShot) throw new Error('Save or cancel the tracked shot first.');
  return operate(r, h => {
    h.putts = n; h.puttStarts = Array.from({ length: n }, () => null);
    h.log = [...h.log.filter(op => op !== 'putt' && op !== 'holed'), ...Array.from({ length: n }, () => 'putt' as const)];
    h.completed = true; delete h.correction;
    // Never use putting, completion, or the estimated pin to invent an endpoint.
  }, holeNo);
}

export type Recovery = { start: LngLat | null; source: 'tee' | 'last-finish' | 'unknown'; sourceShotId: string | null; sourceAcc: number | null };
export function recoveryStart(h: HoleState, hole: Hole, teeId: string): Recovery {
  const previous = h.shots.at(-1);
  if (previous) return { start: previous.end, source: previous.end ? 'last-finish' : 'unknown',
    sourceShotId: shotId(previous, h.shots.length - 1, hole.number), sourceAcc: previous.endAcc ?? null };
  // A missing tee stays unknown: don't substitute the green or another set of tees.
  return { start: hole.tees?.[teeId]?.pos ?? null, source: hole.tees?.[teeId] ? 'tee' : 'unknown', sourceShotId: null, sourceAcc: 8 };
}
export type RecoverySuggestion = Recovery & { club: string; yards: number; finish: ShotFix };
export type RecoveryGap = RecoverySuggestion & { mayBeMultiple: boolean };
export function recoveryGap(h: HoleState, hole: Hole, teeId: string, fix: ShotFix | null, bag: Bag, settledMs: number, now = Date.now()): RecoveryGap | null {
  if (h.pendingShot || h.completed || h.putts || !validFix(fix, now) || !Number.isFinite(settledMs) || settledMs < 2_000) return null;
  const start = recoveryStart(h, hole, teeId);
  if (!start.start || start.sourceAcc == null || start.sourceAcc > 15) return null;
  const yards = distYd(start.start, fix.pos);
  const clubs = bag.clubs.filter(c => c.on && c.id !== PUTTER && c.stock != null && Number.isFinite(c.stock) && c.stock > 0);
  if (!clubs.length || yards <= Math.max(20, 2 * (start.sourceAcc + fix.acc) * M_TO_YD)) return null;
  const club = clubs.reduce((a, b) => Math.abs(b.stock! - yards) < Math.abs(a.stock! - yards) ? b : a);
  return { ...start, club: club.id, yards: Math.round(yards), finish: structuredClone(fix), mayBeMultiple: yards > Math.max(...clubs.map(c => c.stock!)) * 1.35 };
}
export function suggestRecovery(h: HoleState, hole: Hole, teeId: string, fix: ShotFix | null, bag: Bag, settledMs: number, now = Date.now()): RecoverySuggestion | null {
  const gap = recoveryGap(h, hole, teeId, fix, bag, settledMs, now);
  return gap && !gap.mayBeMultiple ? gap : null;
}
export function stockClubFor(start: LngLat | null, end: LngLat | null, bag: Bag): string | null {
  if (!start || !end) return null;
  const yards = distYd(start, end);
  const clubs = bag.clubs.filter(c => c.on && c.id !== PUTTER && c.stock != null);
  return clubs.length ? clubs.reduce((a, b) => Math.abs(b.stock! - yards) < Math.abs(a.stock! - yards) ? b : a).id : null;
}
export function addRecoveredShot(r: Round, suggestion: RecoverySuggestion, hole: Hole, now = Date.now()): Round {
  const h = r.holes[r.current] ?? emptyHole();
  if (r.done || r.current !== hole.number || h.pendingShot || h.completed || h.putts || !validFix(suggestion.finish, now)) return r;
  const current = recoveryStart(h, hole, r.teeId);
  if (current.sourceShotId !== suggestion.sourceShotId || JSON.stringify(current.start) !== JSON.stringify(suggestion.start)) return r;
  return operate(r, h => {
    h.shots.push({ id: crypto.randomUUID(), club: suggestion.club, pos: suggestion.start, end: suggestion.finish.pos,
      acc: suggestion.sourceAcc ?? 0, t: now, endAcc: suggestion.finish.acc, endT: suggestion.finish.t,
      mishit: false, origin: 'recovered', startSource: suggestion.source });
    h.log.push('shot');
  });
}

// Edits keep the operation order, penalties, putts, active hole, and completed status.
export function insertEditedShot(h: HoleState, holeNo: number, index: number, club: string): HoleState {
  const n = prepareHole(h, holeNo);
  const i = Math.max(0, Math.min(index, n.shots.length));
  n.shots.splice(i, 0, { id: crypto.randomUUID(), club, pos: null, end: null, acc: 0, t: Date.now(), mishit: false, origin: 'manual', startSource: 'unknown' });
  let seen = 0; let logIndex = n.log.findIndex(op => op === 'shot' && seen++ === i);
  if (logIndex < 0) { const firstPutt = n.log.indexOf('putt'); logIndex = firstPutt < 0 ? n.log.length : firstPutt; }
  n.log.splice(logIndex, 0, 'shot');
  return n;
}
export function deleteEditedShot(h: HoleState, id: string): HoleState {
  const n = structuredClone(h), index = n.shots.findIndex(s => s.id === id);
  if (index < 0) return n;
  n.shots.splice(index, 1);
  let seen = 0; const logIndex = n.log.findIndex(op => op === 'shot' && seen++ === index);
  if (logIndex >= 0) n.log.splice(logIndex, 1);
  return n;
}
export function commitHoleEdit(r: Round, holeNo: number, expected: HoleState, draft: HoleState): Round {
  if (JSON.stringify(r.holes[holeNo] ?? emptyHole()) !== JSON.stringify(expected)) throw new Error('This hole changed. Close the editor and reopen it before saving.');
  return editHole(r, h => Object.assign(h, draft), holeNo);
}
// Split only the selected gap at a remembered ball stop. These inferred clubs
// never train stock distances, and the draft is saved only by the editor.
export function splitEditedShot(h: HoleState, holeNo: number, id: string, stop: LngLat, bag: Bag): HoleState {
  const index = h.shots.findIndex(s => s.id === id), shot = h.shots[index];
  if (!shot?.pos || !shot.end || distYd(shot.pos, stop) < 1 || distYd(stop, shot.end) < 1) throw new Error('Place the ball stop between the start and finish.');
  const n = insertEditedShot(h, holeNo, index + 1, stockClubFor(stop, shot.end, bag) ?? shot.club);
  n.shots[index] = { ...n.shots[index], end: stop, endAcc: null, endT: undefined,
    club: stockClubFor(shot.pos, stop, bag) ?? shot.club, origin: 'recovered' };
  n.shots[index + 1] = { ...n.shots[index + 1], pos: stop, end: shot.end, endAcc: shot.endAcc, endT: shot.endT, origin: 'recovered', startSource: 'manual' };
  return n;
}
