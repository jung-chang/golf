import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import members from '../worker/members';
import type { AppEnv } from '../worker/env';

type Row = Record<string, unknown>;

// Just enough of D1 for these routes: SELECTs return rows, UPDATEs are recorded.
function fakeDb(rows: Row[]) {
  const updates: { sql: string; binds: unknown[] }[] = [];
  const stmt = (sql: string, binds: unknown[]) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    first: async <T>() => (sql.startsWith('SELECT') ? (rows.find((r) => r.email === binds[0]) ?? null) as T : null),
    all: async <T>() => ({ results: rows as T[] }),
    run: async () => {
      updates.push({ sql, binds });
      return {};
    },
  });
  return { updates, prepare: (sql: string) => stmt(sql, []) };
}

const row = (email: string, extra: Row = {}): Row => ({
  email, name: '', home_course: null, show_handicap: 0, notify_games: 1, handicap: null, created_at: '', ...extra,
});

function app(email: string, db: ReturnType<typeof fakeDb>) {
  const h = new Hono<AppEnv>();
  h.use('*', async (c, next) => {
    c.set('email', email);
    await next();
  });
  h.route('/', members);
  return (path: string, init?: RequestInit) =>
    h.request(path, init, { DB: db } as unknown as AppEnv['Bindings']);
}

const json = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('members', () => {
  it('maps the caller row to Member', async () => {
    const db = fakeDb([row('me@x.com', { name: 'Kev', home_course: 'CLR', show_handicap: 1, notify_games: 0, handicap: 12.4 })]);
    const res = await app('me@x.com', db)('/me');
    expect(await res.json()).toEqual({
      email: 'me@x.com', name: 'Kev', homeCourse: 'CLR', showHandicap: true, notifyGames: false, handicap: 12.4,
    });
  });

  it('updates only the provided fields with bound values', async () => {
    const db = fakeDb([row('me@x.com', { name: 'Kev' })]);
    const res = await app('me@x.com', db)('/me', json({ name: 'Kevin', notifyGames: false }));
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].sql).toBe('UPDATE members SET name = ?, notify_games = ? WHERE email = ?');
    expect(db.updates[0].binds).toEqual(['Kevin', 0, 'me@x.com']);
  });

  it('rejects unknown course codes and bad bodies with 400', async () => {
    const h = app('me@x.com', fakeDb([row('me@x.com')]));
    expect((await h('/me', json({ homeCourse: 'NOPE' }))).status).toBe(400);
    expect((await h('/me', json({ handicap: 'high' }))).status).toBe(400);
  });

  it('hides other members handicaps unless they opted in', async () => {
    const db = fakeDb([
      row('me@x.com', { name: 'Kev', handicap: 9 }),
      row('b@x.com', { name: 'Bea', handicap: 14, show_handicap: 1 }),
      row('c@x.com', { name: 'Cy', handicap: 20 }),
    ]);
    const list = await (await app('me@x.com', db)('/members')).json() as { email: string; handicap: number | null }[];
    expect(Object.fromEntries(list.map((m) => [m.email, m.handicap]))).toEqual({
      'me@x.com': 9, 'b@x.com': 14, 'c@x.com': null,
    });
  });
});
