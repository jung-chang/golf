import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import games, { remindGames } from '../worker/games';
import { notify } from '../worker/push';
import type { AppEnv, Env } from '../worker/env';
import type { Game } from '../src/schemas/group';
import { capacity, countdown, dayLabel, gameLabel, phase } from '../src/features/games/label';

const at = (time: string) => [{ teetime: '', time, spots: 4, bookedBy: null }];

describe('game labels', () => {
  it('formats a game as code, weekday, date and first tee time', () => {
    expect(gameLabel({ code: 'CLR', date: '2025-10-18', times: at('07:12') })).toBe('CLR Sat Oct 18, 7:12am');
  });

  it('uses the calendar date, not the viewer time zone', () => {
    expect(gameLabel({ code: 'DYK', date: '2026-01-01', times: at('13:05') })).toBe('DYK Thu Jan 1, 1:05pm');
  });

  it('formats the day on its own', () => {
    expect(dayLabel('2025-10-18')).toBe('Sat, Oct 18');
  });

  it('adds up spots across tee times', () => {
    expect(capacity({ times: [...at('07:12'), { teetime: '', time: '07:21', spots: 3, bookedBy: null }] })).toBe(7);
  });

  it('knows where a game is in its life', () => {
    expect(phase({ date: '2026-10-18' }, '2026-10-15')).toBe('upcoming');
    expect(phase({ date: '2026-10-15' }, '2026-10-15')).toBe('today');
    expect(phase({ date: '2026-10-11' }, '2026-10-15')).toBe('played');
  });

  it('counts down in calendar days, then hours', () => {
    const tee = '2026-10-17T11:12:00.000Z'; // Sat 7:12am EDT
    expect(countdown(tee, Date.parse('2026-10-16T01:00:00Z'))).toBe('in 2 days'); // Thu 9pm
    expect(countdown(tee, Date.parse('2026-10-16T16:00:00Z'))).toBe('tomorrow'); // Fri noon
    expect(countdown(tee, Date.parse('2026-10-17T09:00:00Z'))).toBe('in 2h 12m');
    expect(countdown(tee, Date.parse('2026-10-17T11:10:00Z'))).toBe('now');
    expect(countdown(tee, Date.parse('2026-10-17T12:00:00Z'))).toBe('teed off');
  });
});

// Routes and reminders, against a fake D1.
vi.mock('../worker/push', () => ({ notify: vi.fn(async () => {}) }));

type Player = { email: string; status: 'in' | 'out'; name: string; checked_in?: string | null };
type Time = { teetime: string; time: string; spots: number; bookedBy: string | null };

function fakeGameDb(players: Player[], times: Time[] = [{ teetime: '2026-10-18T11:12:00.000Z', time: '07:12', spots: 4, bookedBy: null }], rounds: { email: string; data: unknown }[] = []) {
  const game = {
    id: 'g1', code: 'CLR', facility_id: 4047, date: '2026-10-18', teetime: times[0].teetime,
    holes: 18, note: null, created_by: 'ann@x.com', status: 'open', updated_at: '',
  };
  const writes: { sql: string; binds: unknown[] }[] = [];
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => {
      if (sql.includes('FROM games g')) {
        return { results: players.map((p) => ({ ...game, times: JSON.stringify(times), p_email: p.email, p_status: p.status, p_name: p.name, p_checked_in: p.checked_in ?? null })) };
      }
      if (sql.includes('FROM rounds r')) return { results: rounds.map((r) => ({ email: r.email, data: JSON.stringify(r.data), name: null })) };
      if (sql.includes('notify_games')) return { results: binds.map((email) => ({ email })) };
      return { results: [] };
    },
    first: async () => (sql.includes('FROM members') ? { name: players.find((p) => p.email === binds[0])?.name ?? '' } : null),
    run: async () => { writes.push({ sql, binds }); return {}; },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async () => [] as unknown[] };
  return { DB, writes };
}

function client(email: string, DB: unknown) {
  const h = new Hono<AppEnv>();
  h.use('*', async (c, next) => { c.set('email', email); await next(); });
  h.route('/', games);
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
  return (path: string, init?: RequestInit) => h.request(path, init, { DB } as unknown as AppEnv['Bindings'], ctx);
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ann = { email: 'ann@x.com', status: 'in' as const, name: 'Ann' };
const bob = { email: 'bob@x.com', status: 'in' as const, name: 'Bob' };

describe('game routes', () => {
  beforeEach(() => vi.mocked(notify).mockClear());

  it('serves a calendar event spanning every tee time', async () => {
    const { DB } = fakeGameDb([ann], [
      { teetime: '2026-10-18T11:12:00.000Z', time: '07:12', spots: 4, bookedBy: null },
      { teetime: '2026-10-18T11:21:00.000Z', time: '07:21', spots: 4, bookedBy: null },
    ]);
    const ics = await (await client('ann@x.com', DB)('/g1/ics')).text();
    expect(ics).toContain('DTSTART:20261018T111200Z');
    expect(ics).toContain('DTEND:20261018T155100Z'); // last time + 4½ hours
    expect(ics).toContain('LOCATION:Clearview Golf Course\\, New York');
    expect(ics).toContain('DESCRIPTION:Tee times 7:12am\\, 7:21am\\nWith Ann');
  });

  it('tells the proposer when someone joins', async () => {
    const players: Player[] = [{ ...ann }];
    const fake = fakeGameDb(players);
    fake.DB.batch = async () => { players.push({ ...bob }); return []; };
    const res = await client('bob@x.com', fake.DB)('/g1/rsvp', put({ status: 'in' }));
    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledWith(expect.anything(), ['ann@x.com'], expect.objectContaining({
      title: 'Bob is in: CLR Sun Oct 18, 7:12am', body: '2 in · 2 spots left', url: '/#games/g1',
    }));
  });

  it('has no player cap: the fifth player is in, and the proposer hears another time is needed', async () => {
    const players: Player[] = ['a', 'b', 'c', 'd'].map((n) => ({ email: `${n}@x.com`, status: 'in', name: n }));
    players[0].email = 'ann@x.com';
    const fake = fakeGameDb(players);
    fake.DB.batch = async () => { players.push({ email: 'eve@x.com', status: 'in', name: 'Eve' }); return []; };
    const res = await client('eve@x.com', fake.DB)('/g1/rsvp', put({ status: 'in' }));
    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledWith(expect.anything(), ['ann@x.com'], expect.objectContaining({ body: '5 in, 4 spots · add another tee time' }));
  });

  it('marks one tee time booked and recomputes the game', async () => {
    const { DB, writes } = fakeGameDb([ann, bob]);
    await client('bob@x.com', DB)('/g1/book', put({ teetime: '2026-10-18T11:12:00.000Z', booked: true }));
    const w = writes.find((x) => x.sql.startsWith('UPDATE games SET times'))!;
    expect(JSON.parse(w.binds[0] as string)[0].bookedBy).toBe('bob@x.com');
    expect(w.binds[2]).toBe('booked'); // its only time is booked
    expect(writes.some((x) => x.sql.includes("VALUES (?1, ?2, 'in')") && x.binds[1] === 'bob@x.com')).toBe(true); // the booker is in
    expect(notify).toHaveBeenCalledWith(expect.anything(), ['ann@x.com'], expect.objectContaining({ title: 'Booked: CLR 7:12am' }));
  });

  it('adds a tee time to an existing game', async () => {
    const { DB, writes } = fakeGameDb([ann]);
    await client('ann@x.com', DB)('/g1/times', { ...put({ teetime: '2026-10-18T11:03:00.000Z', time: '07:03', spots: 4 }), method: 'POST' });
    const w = writes.find((x) => x.sql.startsWith('UPDATE games SET times'))!;
    expect(JSON.parse(w.binds[0] as string).map((t: Time) => t.time)).toEqual(['07:03', '07:12']); // earliest first
    expect(w.binds[1]).toBe('2026-10-18T11:03:00.000Z');
  });

  it("won't add a tee time from another day", async () => {
    const { DB } = fakeGameDb([ann]);
    const res = await client('ann@x.com', DB)('/g1/times', { ...put({ teetime: '2026-10-19T11:03:00.000Z', time: '07:03', spots: 4 }), method: 'POST' });
    expect(res.status).toBe(400);
  });

  it("only lets the booker undo a booking", async () => {
    const { DB } = fakeGameDb([ann, bob], [{ teetime: '2026-10-18T11:12:00.000Z', time: '07:12', spots: 4, bookedBy: 'ann@x.com' }]);
    const res = await client('bob@x.com', DB)('/g1/book', put({ teetime: '2026-10-18T11:12:00.000Z', booked: false }));
    expect(res.status).toBe(403);
  });

  it('checks a player in, putting them in too', async () => {
    const { DB, writes } = fakeGameDb([ann]);
    await client('bob@x.com', DB)('/g1/checkin', put({}));
    expect(writes.some((w) => w.sql.includes("VALUES (?1, ?2, 'in', ?3)") && w.binds[1] === 'bob@x.com')).toBe(true);
  });

  it('shows scores from rounds started from the game, best first, not-started last', async () => {
    const round = (email: string, holes: Record<string, number>, done = false) => ({
      email,
      data: {
        id: email, courseId: 'clearview-park', courseName: 'Clearview', gameId: 'g1', teeId: 'white', teeName: 'White',
        date: '2026-10-18T11:00:00.000Z', pars: { 1: 4, 2: 3 }, current: 1, done, updatedAt: '2026-10-18T12:00:00.000Z',
        holes: Object.fromEntries(Object.entries(holes).map(([n, strokes]) => [n, { shots: [], putts: strokes, penalties: 0, adj: 0, pin: null, log: [] }])),
      },
    });
    const { DB } = fakeGameDb([ann, bob], undefined, [round('ann@x.com', { 1: 6, 2: 4 }), round('bob@x.com', { 1: 4 }), round('cat@x.com', {})]);
    const g = await (await client('ann@x.com', DB)('/')).json() as Game[];
    expect(g[0].scores.map((s) => [s.name, s.toPar, s.thru])).toEqual([['bob', 0, 1], ['ann', 3, 2], ['cat', 0, 0]]);
  });
});

describe('remindGames', () => {
  beforeEach(() => vi.mocked(notify).mockClear());
  const { DB } = fakeGameDb([ann, { ...bob, status: 'out' }]);
  const env = { DB } as unknown as Env;

  it('reminds the players who are in at 7am New York time', async () => {
    await remindGames(env, new Date('2026-10-18T11:00:00Z')); // 7:00am EDT
    expect(notify).toHaveBeenCalledWith(env, ['ann@x.com'], expect.objectContaining({ title: 'Today: CLR Sun Oct 18, 7:12am', body: 'Not booked yet · Ann' }));
  });

  it('only runs on the 7am tick', async () => {
    await remindGames(env, new Date('2026-10-18T11:15:00Z'));
    await remindGames(env, new Date('2026-10-18T12:00:00Z'));
    expect(notify).not.toHaveBeenCalled();
  });
});
