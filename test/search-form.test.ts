import { describe, expect, it } from 'vitest';
import { defaultForm, FULL_DAY, needsSearch, restoreForm } from '../src/features/teetimes/search-form';

describe('compact search defaults and persistence', () => {
  it('chooses the next Saturday and Sunday, including Saturday and year boundaries', () => {
    expect(defaultForm('2026-10-14')).toMatchObject({ dates: ['2026-10-17', '2026-10-18'], golfers: [4], holes: 18, window: FULL_DAY });
    expect(defaultForm('2026-10-17').dates).toEqual(['2026-10-24', '2026-10-25']);
    expect(defaultForm('2026-12-31').dates).toEqual(['2027-01-02', '2027-01-03']);
  });
  it('rejects malformed storage and repairs expired dates and backwards windows', () => {
    const expected = defaultForm('2026-10-14');
    expect(restoreForm({ dates: 'not an array' }, '2026-10-14')).toEqual(expected);
    expect(restoreForm({ ...expected, dates: ['2020-01-01'], codes: ['CLR', 'NOPE'], window: [900, 400] }, '2026-10-14')).toEqual({ ...expected, codes: ['CLR'] });
  });
  it('migrates older search forms without changing the meaning of stored alerts', () => {
    const old = { ...defaultForm('2026-10-14'), holes: undefined, holes18: false, golfers: [], codes: ['CLR'] };
    expect(restoreForm(old, '2026-10-14')).toMatchObject({ holes: 9, golfers: [4], codes: ['CLR'] });
  });
  it('requires explicit searches for dates, holes and players, while time remains a local filter', () => {
    const last = defaultForm('2026-10-14');
    expect(needsSearch({ ...last, window: [480, 720] }, last)).toBe(false);
    expect(needsSearch({ ...last, golfers: [2] }, last)).toBe(true);
    expect(needsSearch({ ...last, holes: 9, holes18: false }, last)).toBe(true);
    expect(needsSearch({ ...last, dates: last.dates.slice(0, 1) }, last)).toBe(true);
  });
});
