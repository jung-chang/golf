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
    const prev = h.shots.at(-1);
    if (prev && !prev.end) prev.end = pos;
    h.shots.push({ club, pos, acc: Math.round(acc), t: Date.now(), end: null, mishit: false });
    h.log.push('shot');
  });

// The first putt is from where the last full shot finished.
export const putt = (r: Round, pos: LngLat | null) =>
  editHole(r, (h) => {
    const prev = h.shots.at(-1);
    if (h.putts === 0 && prev && !prev.end && pos) prev.end = pos;
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
    const op = h.log.pop();
    if (op === 'shot') {
      h.shots.pop();
      const prev = h.shots.at(-1);
      if (prev) prev.end = null; // only the shot we just removed could have ended it
    } else if (op === 'putt') {
      h.putts--;
      const prev = h.shots.at(-1);
      if (h.putts === 0 && prev) prev.end = null;
    } else if (op === 'pen') h.penalties--;
    else if (op === 'holed') h.shots.at(-1)!.end = null;
  });

// Finishing a hole with no putts and an open shot means it went in.
export const holeDone = (r: Round, pin: LngLat) =>
  editHole(r, (h) => {
    const prev = h.shots.at(-1);
    if (prev && !prev.end && h.putts === 0) {
      prev.end = pin;
      h.log.push('holed');
    }
  });
