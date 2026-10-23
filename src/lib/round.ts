// Round actions as pure functions: (round, …) → new round. Easy to test and undo.
import type { Course } from '../schemas/course';
import type { HoleState, Round } from '../schemas/round';
import type { LngLat } from './geo';

export const emptyHole = (): HoleState => ({ shots: [], putts: 0, penalties: 0, adj: 0, pin: null, log: [] });

export const holeScore = (h?: HoleState) => (h ? h.shots.length + h.putts + h.penalties + h.adj : 0);

export const playedHoles = (r: Round) => Object.entries(r.holes).filter(([, h]) => holeScore(h) > 0);
export const totalScore = (r: Round) => playedHoles(r).reduce((s, [, h]) => s + holeScore(h), 0);
export const toPar = (r: Round) => playedHoles(r).reduce((s, [n, h]) => s + holeScore(h) - (r.pars[n] ?? 0), 0);
export const fmtToPar = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

export function newRound(course: Course, teeId: string): Round {
  const tee = course.tees.find((t) => t.id === teeId);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    courseId: course.id,
    courseName: course.name,
    teeId,
    teeName: tee?.name ?? teeId,
    rating: tee?.rating,
    slope: tee?.slope,
    date: now,
    pars: Object.fromEntries(course.holes.map((h) => [h.number, h.par])),
    holes: {},
    current: course.holes[0].number,
    done: false,
    updatedAt: now,
  };
}

// Apply `fn` to a copy of the current hole and return the updated round.
export function editHole(r: Round, fn: (h: HoleState) => void, holeNo = r.current): Round {
  const h = structuredClone(r.holes[holeNo] ?? emptyHole());
  fn(h);
  return { ...r, holes: { ...r.holes, [holeNo]: h }, updatedAt: new Date().toISOString() };
}

// You're standing at your ball: that ends the previous shot and starts this one.
export const markShot = (r: Round, club: string, pos: LngLat, acc: number) =>
  editHole(r, (h) => {
    const saved = h.correction;
    h.completed = false;
    const start = saved?.pos ?? pos;
    const prev = h.shots.at(-1);
    if (prev && !prev.end) prev.end = start;
    h.shots.push({ club, pos: start, acc: saved?.acc ?? Math.round(acc), t: saved?.t ?? Date.now(), end: null, mishit: saved?.mishit ?? false });
    delete h.correction;
    h.log.push('shot');
  });

// The first putt is from where the last full shot finished.
export const putt = (r: Round, pos: LngLat | null, acc?: number, t = Date.now()) =>
  editHole(r, (h) => {
    h.completed = false;
    const prev = h.shots.at(-1);
    const start = h.correction?.pos ?? pos;
    if (h.putts === 0 && prev && !prev.end && start) prev.end = start;
    h.puttStarts ??= [];
    while (h.puttStarts.length < h.putts) h.puttStarts.push(null);
    h.puttStarts.push(h.correction ? { ...h.correction, club: 'pt', end: null } : pos && acc != null ? { club: 'pt', pos, acc, t, end: null, mishit: false } : null);
    delete h.correction;
    h.putts++;
    h.log.push('putt');
  });

export const penalty = (r: Round) => editHole(r, (h) => { h.penalties++; h.log.push('pen'); });

export const adjust = (r: Round, d: number) =>
  editHole(r, (h) => { if (holeScore(h) + d >= 0) h.adj += d; });

export const setPin = (r: Round, pin: LngLat) => editHole(r, (h) => { h.pin = pin; });

export const toggleMishit = (r: Round, i: number) => editHole(r, (h) => { h.shots[i].mishit = !h.shots[i].mishit; });

export const undo = (r: Round) =>
  editHole(r, (h) => {
    h.completed = false;
    const op = h.log.pop();
    if (op === 'shot') {
      h.correction = h.shots.pop();
      const prev = h.shots.at(-1);
      if (prev) prev.end = null; // only the shot we just removed could have ended it
    } else if (op === 'putt') {
      h.correction = h.puttStarts?.pop() ?? undefined;
      h.putts--;
      const prev = h.shots.at(-1);
      if (h.putts === 0 && prev) prev.end = null;
    } else if (op === 'pen') h.penalties--;
    else if (op === 'holed') h.shots.at(-1)!.end = null;
  });

// Finishing a hole with no putts and an open shot means it went in.
export const holeDone = (r: Round, pin: LngLat) =>
  editHole(r, (h) => {
    h.completed = true;
    delete h.correction;
    const prev = h.shots.at(-1);
    if (prev && !prev.end && h.putts === 0) {
      prev.end = pin;
      h.log.push('holed');
    }
  });

// "I took n putts": finishes the hole in one step, replacing any putts already
// counted. Your position on the green ends the approach; 0 putts means it went in.
export const setPutts = (r: Round, n: number, pos: LngLat | null, pin: LngLat, holeNo = r.current) =>
  editHole(r, (h) => {
    const prev = h.shots.at(-1);
    if (prev && h.log.includes('holed')) prev.end = null; // set by holing out, not by where you stood
    h.log = h.log.filter((op) => op !== 'putt' && op !== 'holed');
    delete h.correction;
    h.putts = n;
    h.puttStarts = Array.from({ length: n }, () => null);
    if (prev && n === 0) { prev.end = pin; h.log.push('holed'); }
    if (prev && n > 0 && !prev.end && pos) prev.end = pos;
    for (let i = 0; i < n; i++) h.log.push('putt');
    h.completed = true;
  }, holeNo);

// Back to playing a finished hole: drop the putt count (or the holed-out finish) in one
// step, so the last shot is open again. The counterpart of setPutts.
export const reopen = (r: Round, holeNo = r.current) =>
  editHole(r, (h) => {
    const prev = h.shots.at(-1);
    if (prev && (h.putts > 0 || h.log.includes('holed'))) prev.end = null; // set by putts or holing out
    h.log = h.log.filter((op) => op !== 'putt' && op !== 'holed');
    h.putts = 0;
    h.puttStarts = [];
    delete h.correction;
    h.completed = false;
  }, holeNo);
