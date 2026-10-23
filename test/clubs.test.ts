import { describe, expect, it } from 'vitest';
import { clubStats, defaultBag, suggestClub } from '../src/lib/clubs';
import { M_TO_YD, offset, type LngLat } from '../src/lib/geo';
import type { Round } from '../src/schemas/round';

const me: LngLat = [-73.79, 40.78];
const shot = (club: string, yd: number, mishit = false) => ({ club, pos: me, end: offset(me, 0, yd / M_TO_YD), acc: 3, t: Date.now(), mishit });
const roundWith = (shots: ReturnType<typeof shot>[]) =>
  ({ holes: { 1: { shots, putts: 0, penalties: 0, adj: 0, pin: null, log: [] } } }) as unknown as Round;

describe('suggestClub', () => {
  const bag = defaultBag();
  it.each([[150, '7i'], [157, '7i'], [160, '6i'], [400, 'dr'], [40, 'lw']])('%i yd → %s', (yd, id) => {
    expect(suggestClub(yd, bag, {})?.club.id).toBe(id);
  });

  it('uses tracked distances once a club has 3 good shots', () => {
    const stats = clubStats([roundWith([shot('7i', 170), shot('7i', 168), shot('7i', 172), shot('7i', 90, true)])]);
    expect(stats['7i'].n).toBe(3);
    expect(stats['7i'].recent).toBeCloseTo(170, 0);
    expect(suggestClub(171, bag, stats)?.club.id).toBe('7i');
    expect(suggestClub(171, { ...bag, useTracked: false }, stats)?.club.id).toBe('5i');
  });
});

describe('clubStats sanity', () => {
  it('leaves out shots longer than anyone hits (marked from somewhere else)', () => {
    const stats = clubStats([roundWith([shot('7i', 150), shot('7i', 152), shot('7i', 19_300)])]);
    expect(stats['7i'].n).toBe(2);
    expect(stats['7i'].median).toBeCloseTo(151, 0);
  });
});
