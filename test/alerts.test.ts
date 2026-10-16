import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTeeTimes } from '../worker/teetimes';
import { notify } from '../worker/push';
import { alertDates, isDue, newMatches, nextSeen, runAlerts } from '../worker/alerts';
import type { Env } from '../worker/env';
import type { Criteria, TeeTime } from '../src/schemas/teetimes';
import { timeKey } from '../src/schemas/teetimes';

vi.mock('../worker/teetimes', () => ({ getTeeTimes: vi.fn() }));
vi.mock('../worker/push', () => ({ notify: vi.fn() }));

const NOON_NY = new Date('2026-10-14T16:00:00Z');

const tee = (over: Partial<TeeTime>): TeeTime => ({
  code: 'CLR', facilityId: 4047, date: '2026-10-20', time: '08:00', teetime: '2026-10-20T12:00:00.000Z',
  spots: 4, holes: [18], priceCents: null, ...over,
});

const criteria = (over: Partial<Criteria> = {}): Criteria => ({
  dates: ['2026-10-20'], golfers: [], codes: ['CLR', 'DGL'], holes18: false, window: [300, 1200], ...over,
});

describe('isDue', () => {
  it('runs hourly alerts every hour from 6am to 9pm New York time', () => {
    expect(isDue(1, new Date('2026-10-14T10:00:00Z'))).toBe(true); // 6am EDT
    expect(isDue(1, new Date('2026-10-15T01:00:00Z'))).toBe(true); // 9pm EDT
    expect(isDue(1, new Date('2026-10-15T02:00:00Z'))).toBe(false); // 10pm EDT
    expect(isDue(1, new Date('2026-10-14T09:00:00Z'))).toBe(false); // 5am EDT
  });

  it('runs 4-hour alerts at 7, 11, 3 and 7', () => {
    expect(isDue(4, new Date('2026-10-14T15:00:00Z'))).toBe(true); // 11am EDT
    expect(isDue(4, new Date('2026-10-14T19:00:00Z'))).toBe(true); // 3pm EDT
    expect(isDue(4, new Date('2026-10-14T16:00:00Z'))).toBe(false); // 12pm EDT
  });

  it('runs 12-hour alerts at 7am and 7pm, following the winter offset', () => {
    expect(isDue(12, new Date('2026-10-14T11:00:00Z'))).toBe(true); // 7am EDT
    expect(isDue(12, new Date('2026-12-01T12:00:00Z'))).toBe(true); // 7am EST
    expect(isDue(12, new Date('2026-12-01T11:00:00Z'))).toBe(false); // 6am EST
  });

  it('acts only on the top-of-the-hour tick', () => {
    expect(isDue(1, new Date('2026-10-14T16:30:00Z'))).toBe(false);
  });
});

describe('alertDates', () => {
  it('keeps today and later', () => {
    expect(alertDates({ criteria: criteria({ dates: ['2026-10-13', '2026-10-14', '2026-10-15'] }), weekdays: [] }, NOON_NY))
      .toEqual(['2026-10-14', '2026-10-15']);
  });

  it('is empty when every date has passed', () => {
    expect(alertDates({ criteria: criteria({ dates: ['2026-10-01'] }), weekdays: [] }, NOON_NY)).toEqual([]);
  });

  it('repeats on its weekdays across the 14-day window', () => {
    // Wed Oct 14: the Saturdays and Sundays up to Wed Oct 28.
    expect(alertDates({ criteria: criteria({ dates: ['2026-10-01'] }), weekdays: [6, 0] }, NOON_NY))
      .toEqual(['2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25']);
  });
});

describe('nextSeen', () => {
  const a = tee({ teetime: '2026-10-20T11:00:00.000Z' });
  const b = tee({ teetime: '2026-10-20T13:00:00.000Z' });

  it('drops times that are gone, so they count as new if they come back', () => {
    expect(nextSeen([timeKey(a), timeKey(b)], [a], [])).toEqual([timeKey(a)]);
  });

  it('keeps times from a tenant/date that failed to load', () => {
    expect(nextSeen([timeKey(a), timeKey(b)], [], [{ tenant: 'golf-nyc', date: '2026-10-20' }])).toEqual([timeKey(a), timeKey(b)]);
  });
});

describe('newMatches', () => {
  const a = tee({ code: 'DGL', facilityId: 5044, time: '07:00', teetime: '2026-10-20T11:00:00.000Z', spots: 2 });
  const b = tee({ time: '09:00', teetime: '2026-10-20T13:00:00.000Z', spots: 1 }); // too few spots for 2 golfers
  const c = tee({ time: '11:00', teetime: '2026-10-20T15:00:00.000Z', holes: [9] }); // 9 holes only
  const d = tee({ time: '13:00', teetime: '2026-10-20T17:00:00.000Z', spots: 3 });
  const times = [d, c, b, a];

  it('splits matches into fresh and already seen', () => {
    const got = newMatches(times, { criteria: criteria({ golfers: [2], holes18: true }), seen: [timeKey(a)] });
    expect(got.fresh).toEqual([d]);
    expect(got.seen).toEqual([a]);
  });

  it('treats everything as fresh when nothing was seen', () => {
    const got = newMatches(times, { criteria: criteria({ golfers: [2], holes18: true }), seen: [] });
    expect(got.fresh).toEqual([a, d]);
    expect(got.seen).toEqual([]);
  });

  it('counts notified-but-unopened times as new', () => {
    const got = newMatches(times, { criteria: criteria({ golfers: [2], holes18: true }), seen: [timeKey(a), timeKey(d)], unread: [timeKey(d)] });
    expect(got.fresh).toEqual([d]);
    expect(got.seen).toEqual([a]);
  });

  it('respects the time window', () => {
    const got = newMatches(times, { criteria: criteria({ window: [600, 700] }), seen: [] });
    expect(got.fresh).toEqual([c]); // 11:00 is inside 10:00 to 11:40
  });
});

type Row = {
  id: string; email: string; criteria: string; seen: string; weekdays: string; unread: string; every: number;
  paused: number; created_at: string; checked_at: string | null;
};

function fakeEnv(rows: Row[]) {
  const writes: { sql: string; args: unknown[] }[] = [];
  const DB = {
    prepare: (sql: string) => {
      const all = async () => ({ results: sql.includes('paused = 0') ? rows.filter((r) => !r.paused) : [] });
      return { all, bind: (...args: unknown[]) => ({ all, run: async () => { writes.push({ sql, args }); return {}; } }) };
    },
  };
  return { env: { DB } as unknown as Env, writes };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'a1', email: 'kev@example.com', criteria: JSON.stringify(criteria({ dates: ['2026-10-14'], codes: ['CLR'] })),
  seen: '[]', weekdays: '[]', unread: '[]', every: 1, paused: 0, created_at: '2026-10-01T00:00:00.000Z', checked_at: null, ...over,
});

describe('runAlerts', () => {
  beforeEach(() => {
    vi.mocked(getTeeTimes).mockReset();
    vi.mocked(notify).mockReset();
  });

  it('does nothing outside the check hours', async () => {
    const { env, writes } = fakeEnv([row()]);
    await runAlerts(env, new Date('2026-10-15T03:00:00Z')); // 11pm
    expect(getTeeTimes).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('skips alerts that are not due this hour', async () => {
    const { env } = fakeEnv([row({ every: 4 })]); // 4-hour alerts don't run at noon
    await runAlerts(env, NOON_NY);
    expect(getTeeTimes).not.toHaveBeenCalled();
  });

  it('notifies about new times, marks them seen and records the check', async () => {
    const fresh = tee({ date: '2026-10-14', time: '12:00', teetime: '2026-10-14T16:00:00.000Z', spots: 2 });
    vi.mocked(getTeeTimes).mockResolvedValue({ times: [fresh], fetched: {}, errors: [] });
    const { env, writes } = fakeEnv([row()]);

    await runAlerts(env, NOON_NY);

    expect(getTeeTimes).toHaveBeenCalledWith(['2026-10-14'], ['CLR'], { force: true });
    expect(notify).toHaveBeenCalledWith(env, ['kev@example.com'], {
      title: '1 new tee time',
      body: 'Wed 12:00pm CLR (2)',
      url: '/#alerts/a1',
      tag: 'alert-a1',
    });
    const update = writes.find((w) => w.sql.startsWith('UPDATE alerts'))!;
    expect(JSON.parse(update.args[0] as string)).toEqual([timeKey(fresh)]); // seen
    expect(JSON.parse(update.args[1] as string)).toEqual([timeKey(fresh)]); // unread
    expect(update.args[2]).toBe(NOON_NY.toISOString());
  });

  it('notifies again when a booked time comes back', async () => {
    const t = tee({ date: '2026-10-14', time: '12:00', teetime: '2026-10-14T16:00:00.000Z' });
    const seenRow = row({ seen: JSON.stringify([timeKey(t)]), checked_at: '2026-10-14T15:45:00.000Z' });

    vi.mocked(getTeeTimes).mockResolvedValue({ times: [], fetched: {}, errors: [] }); // booked
    const gone = fakeEnv([seenRow]);
    await runAlerts(gone.env, NOON_NY);
    const seenAfter = gone.writes.find((w) => w.sql.startsWith('UPDATE alerts'))!.args[0] as string;
    expect(JSON.parse(seenAfter)).toEqual([]);

    vi.mocked(getTeeTimes).mockResolvedValue({ times: [t], fetched: {}, errors: [] }); // cancelled
    const back = fakeEnv([{ ...seenRow, seen: seenAfter }]);
    await runAlerts(back.env, NOON_NY);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-send times it already saw when the fetch fails", async () => {
    const t = tee({ date: '2026-10-14', time: '12:00', teetime: '2026-10-14T16:00:00.000Z' });
    vi.mocked(getTeeTimes).mockResolvedValue({ times: [], fetched: {}, errors: [{ tenant: 'golf-nyc', date: '2026-10-14' }] });
    const { env, writes } = fakeEnv([row({ seen: JSON.stringify([timeKey(t)]) })]);
    await runAlerts(env, NOON_NY);
    expect(JSON.parse(writes.find((w) => w.sql.startsWith('UPDATE alerts'))!.args[0] as string)).toEqual([timeKey(t)]);
  });

  it('takes stock quietly of the extra weeks on a repeating alert\'s first check', async () => {
    const setUpDay = tee({ date: '2026-10-17', teetime: '2026-10-17T12:00:00.000Z' });
    const nextWeek = tee({ date: '2026-10-24', teetime: '2026-10-24T12:00:00.000Z' });
    vi.mocked(getTeeTimes).mockResolvedValue({ times: [setUpDay, nextWeek], fetched: {}, errors: [] });
    const repeating = row({ criteria: JSON.stringify(criteria({ dates: ['2026-10-17'], codes: ['CLR'] })), weekdays: '[6]' });
    const { env, writes } = fakeEnv([repeating]);

    await runAlerts(env, NOON_NY);

    expect(notify).toHaveBeenCalledWith(env, ['kev@example.com'], expect.objectContaining({ title: '1 new tee time' }));
    const update = writes.find((w) => w.sql.startsWith('UPDATE alerts'))!;
    expect(JSON.parse(update.args[0] as string)).toEqual([timeKey(setUpDay), timeKey(nextWeek)]);
  });

  it('stays quiet when nothing is new, but still records the check', async () => {
    vi.mocked(getTeeTimes).mockResolvedValue({ times: [], fetched: {}, errors: [] });
    const { env, writes } = fakeEnv([row()]);
    await runAlerts(env, NOON_NY);
    expect(notify).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });

  it('skips paused alerts, and pauses alerts whose dates have all passed', async () => {
    const past = row({ id: 'old', criteria: JSON.stringify(criteria({ dates: ['2026-10-01'] })) });
    const paused = row({ id: 'p', paused: 1 });
    const { env, writes } = fakeEnv([past, paused]);
    await runAlerts(env, NOON_NY);
    expect(getTeeTimes).not.toHaveBeenCalled();
    expect(writes).toEqual([{ sql: 'UPDATE alerts SET paused = 1 WHERE id = ?', args: ['old'] }]);
  });
});
