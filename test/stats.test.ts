import { describe, expect, it } from 'vitest';
import { handicapIndex, rollingMedian, summarize } from '../src/lib/stats';
import type { HoleState, Round } from '../src/schemas/round';

const hole = (shots: number, putts: number): HoleState => ({
  shots: Array.from({ length: shots }, () => ({ club: '7i', pos: [0, 0], end: null, acc: 3, t: 0, mishit: false })),
  putts, penalties: 0, adj: 0, pin: null, log: [],
});

function round(score: (n: number) => HoleState): Round {
  const nums = Array.from({ length: 18 }, (_, i) => i + 1);
  return {
    id: 'r', courseId: 'c', courseName: 'C', teeId: 't', teeName: 'T', rating: 70, slope: 113,
    date: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', current: 18, done: true,
    pars: Object.fromEntries(nums.map((n) => [n, 4])), holes: Object.fromEntries(nums.map((n) => [n, score(n)])),
  };
}

describe('stats', () => {
  it('summarizes score, putts and greens in regulation', () => {
    const s = summarize(round((n) => (n <= 9 ? hole(2, 2) : hole(3, 2)))); // 9 pars (GIR) + 9 bogeys
    expect(s.score).toBe(81);
    expect(s.putts).toBe(36);
    expect(s.gir).toBe(9);
    expect(s.differential).toBe(11); // (113/113) × (81 − 70)
  });

  it('caps a blow-up hole at double bogey for the differential', () => {
    const s = summarize(round((n) => (n === 1 ? hole(10, 2) : hole(2, 2))));
    expect(s.score).toBe(80);
    expect(s.differential).toBe(4); // 17 pars (68) + the 12 capped at 6 = 74; 74 − 70
  });

  it('handicap index uses the WHS lowest-N table', () => {
    expect(handicapIndex([10, 12])).toBeNull();
    expect(handicapIndex([10, 12, 14])).toBe(8); // lowest 1, −2
    expect(handicapIndex(Array.from({ length: 20 }, (_, i) => i))).toBe(3.5); // avg of 0..7
  });

  it('rolling median', () => {
    expect(rollingMedian([1, 3, 2, 10], 3)).toEqual([1, 2, 2, 3]);
  });
});
