// Progress numbers derived from stored rounds. No extra storage.
import type { Round } from '../schemas/round';
import { holeScore, playedHoles, totalScore } from './round';

export type RoundSummary = {
  id: string;
  t: number; // epoch seconds (uPlot x axis)
  holes: number;
  score: number;
  toPar: number;
  putts: number;
  gir: number; // greens in regulation hit
  girHoles: number; // holes where GIR could be judged (putts logged)
  differential: number | null;
};

// Green in regulation: reached the green (first putt) in par − 2 strokes or fewer.
const isGir = (par: number, h: Round['holes'][string]) => h.putts > 0 && h.shots.length + h.penalties <= par - 2;

// WHS score differential with a simple double-bogey cap per hole (no handicap
// strokes, no playing-conditions adjustment): close enough to track a trend.
export function differential(r: Round): number | null {
  const played = playedHoles(r);
  if (played.length !== 18 || r.rating == null || r.slope == null) return null;
  const adjusted = played.reduce((s, [n, h]) => s + Math.min(holeScore(h), (r.pars[n] ?? 4) + 2), 0);
  return Math.round(((113 / r.slope) * (adjusted - r.rating)) * 10) / 10;
}

export function summarize(r: Round): RoundSummary {
  const played = playedHoles(r);
  const withPutts = played.filter(([, h]) => h.putts > 0);
  return {
    id: r.id,
    t: Math.floor(Date.parse(r.date) / 1000),
    holes: played.length,
    score: totalScore(r),
    toPar: played.reduce((s, [n, h]) => s + holeScore(h) - (r.pars[n] ?? 0), 0),
    putts: played.reduce((s, [, h]) => s + h.putts, 0),
    gir: withPutts.filter(([n, h]) => isGir(r.pars[n] ?? 4, h)).length,
    girHoles: withPutts.length,
    differential: differential(r),
  };
}

// WHS: how many of your lowest differentials count, and the adjustment, by number of rounds.
const WHS_TABLE: Record<number, [number, number]> = {
  3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0],
  12: [4, 0], 13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0],
};

// Handicap index estimate from the most recent 20 differentials (oldest-first input).
export function handicapIndex(diffs: number[]): number | null {
  const recent = diffs.slice(-20);
  if (recent.length < 3) return null;
  const [count, adj] = WHS_TABLE[recent.length] ?? [8, 0];
  const best = [...recent].sort((a, b) => a - b).slice(0, count);
  return Math.round((best.reduce((s, d) => s + d, 0) / count + adj) * 10) / 10;
}

// Rolling median of the last `n` values, aligned with the input.
export function rollingMedian(xs: number[], n = 10): number[] {
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - n + 1), i + 1).sort((a, b) => a - b);
    const m = w.length >> 1;
    return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
  });
}
