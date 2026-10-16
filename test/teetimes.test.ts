import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/kenna-golf-nyc.json';
import app, { getTeeTimes, normalize, ttlSeconds } from '../worker/teetimes';
import type { Criteria, TeeTime } from '../src/schemas/teetimes';
import { filterTimes } from '../src/lib/teetimes';

const NOW = new Date('2026-10-14T16:00:00Z'); // 12:00 in New York

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('normalize', () => {
  it('reads codes, New York time, spots and holes from the saved response', () => {
    const times = normalize(fixture);
    expect(new Set(times.map((t) => t.code))).toEqual(new Set(['DGL', 'CLR']));
    const first = times.find((t) => t.code === 'DGL')!;
    expect(first).toMatchObject({ code: 'DGL', facilityId: 5044, date: '2026-10-20', time: '06:57', teetime: '2026-10-20T10:57:00.000Z', spots: 2, holes: [18] });
    expect(first.priceCents).toBe(5400);
    expect(times.every((t) => t.holes.every((h) => h === 9 || h === 18))).toBe(true);
  });

  it('removes duplicates', () => {
    expect(normalize([...fixture, ...fixture])).toEqual(normalize(fixture));
  });

  it('skips unknown facilities and zero open spots', () => {
    const unknown = structuredClone(fixture);
    unknown[0].teetimes[0].rates[0].golfnow.GolfFacilityId = 99999;
    expect(normalize(unknown).some((t) => t.facilityId === 99999)).toBe(false);

    const full = structuredClone(fixture);
    full[0].teetimes.forEach((t: { maxPlayers: number }) => (t.maxPlayers = 0));
    expect(normalize(full).filter((t) => t.code === 'DGL')).toEqual([]);
  });

  it('throws when the response has the wrong shape', () => {
    expect(() => normalize({ not: 'a list' })).toThrow();
  });
});

describe('ttlSeconds', () => {
  it('is 2 minutes for today and tomorrow, 10 minutes after', () => {
    expect(ttlSeconds('2026-10-14', NOW)).toBe(120);
    expect(ttlSeconds('2026-10-15', NOW)).toBe(120);
    expect(ttlSeconds('2026-10-16', NOW)).toBe(600);
  });
});

describe('filterTimes', () => {
  const at = (code: string, date: string, time: string, spots: number, holes: number[]): TeeTime => ({
    code, facilityId: 1, date, time, teetime: `${date}T${time}:00Z`, spots, holes, priceCents: null,
  });
  const times = [
    at('CLR', '2026-10-14', '08:00', 1, [18]),
    at('CLR', '2026-10-14', '09:00', 2, [9]),
    at('DGL', '2026-10-14', '10:00', 3, [18]),
    at('CLR', '2026-10-14', '11:00', 4, [9, 18]),
    at('SSO', '2026-10-14', '12:00', 4, [18]),
    at('CLR', '2026-10-15', '13:00', 4, [18]),
  ];
  const base: Criteria = { dates: ['2026-10-14'], golfers: [], codes: ['CLR', 'DGL'], holes18: false, window: [0, 1440] };
  const picked = (c: Partial<Criteria>) => filterTimes(times, { ...base, ...c }).map((t) => t.time);

  it('keeps the chosen dates and codes', () => {
    expect(picked({})).toEqual(['08:00', '09:00', '10:00', '11:00']);
    expect(picked({ codes: ['DGL'] })).toEqual(['10:00']);
    expect(picked({ dates: ['2026-10-15'] })).toEqual(['13:00']);
  });

  it('uses the smallest golfer count', () => {
    expect(picked({ golfers: [2, 3] })).toEqual(['09:00', '10:00', '11:00']);
    expect(picked({ golfers: [4] })).toEqual(['11:00']);
  });

  it('can require 18 holes', () => {
    expect(picked({ holes18: true })).toEqual(['08:00', '10:00', '11:00']);
  });

  it('includes both ends of the time window', () => {
    expect(picked({ window: [480, 600] })).toEqual(['08:00', '09:00', '10:00']);
    expect(picked({ window: [601, 659] })).toEqual([]);
  });
});

describe('getTeeTimes', () => {
  const kenna = () => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(fixture), { status: 200 }));

  it('makes one request per tenant per date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const fetchMock = kenna();
    vi.stubGlobal('fetch', fetchMock);

    const res = await getTeeTimes(['2026-10-14', '2026-10-15'], ['CLR', 'DGL', 'PEL']);
    expect(fetchMock).toHaveBeenCalledTimes(4); // golf-nyc and pelham-bay-split-rock, for 2 dates
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('date=2026-10-14'))).toHaveLength(2);
    expect(res.errors).toEqual([]);
    expect(Object.keys(res.fetched).sort()).toEqual([
      'golf-nyc|2026-10-14', 'golf-nyc|2026-10-15', 'pelham-bay-split-rock|2026-10-14', 'pelham-bay-split-rock|2026-10-15',
    ]);
    expect(res.times.every((t) => ['CLR', 'DGL'].includes(t.code))).toBe(true);
  });

  it('never requests Dyker more than 10 days out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await getTeeTimes(['2026-10-14', '2026-10-25'], ['DYK']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('date=2026-10-14');
    expect(String(fetchMock.mock.calls[0][0])).toContain('facilityIds=4048');
  });

  it('reports a failing tenant and still returns the others', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>)['x-be-alias'] === 'pelham-bay-split-rock'
        ? new Response('nope', { status: 500 })
        : new Response(JSON.stringify(fixture), { status: 200 })));

    const res = await getTeeTimes(['2026-10-14'], ['CLR', 'PEL']);
    expect(res.errors).toEqual([{ tenant: 'pelham-bay-split-rock', date: '2026-10-14' }]);
    expect(res.times.length).toBeGreaterThan(0);
    expect(res.times.every((t) => t.code === 'CLR')).toBe(true);
  });
});

describe('GET /', () => {
  it('rejects unknown codes and out-of-range dates with 400', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    expect((await app.request('/?dates=2026-10-14&codes=NOPE')).status).toBe(400);
    expect((await app.request('/?dates=2026-13-45&codes=CLR')).status).toBe(400);
    expect((await app.request('/?dates=2027-06-01&codes=CLR')).status).toBe(400);
  });
});

describe('course picker layout', () => {
  it('shows every course exactly once, in its own borough', async () => {
    const { NYC_COURSES, PICKER, courseByCode } = await import('../src/lib/nyc');
    const codes = PICKER.flatMap((p) => p.rows.flat().filter((c): c is string => !!c));
    expect([...codes].sort()).toEqual(NYC_COURSES.map((c) => c.code).sort());
    for (const p of PICKER) for (const code of p.rows.flat()) if (code) expect(courseByCode(code)?.borough).toBe(p.borough);
  });
});
