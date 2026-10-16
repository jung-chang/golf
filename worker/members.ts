// Group members: each member's own profile, and the list the group sees.
import { Hono } from 'hono';
import { z } from 'zod';
import { Member, MemberUpdate } from '../src/schemas/group';
import { courseByCode } from '../src/lib/nyc';
import { bad } from './rounds';
import type { AppEnv } from './env';

const app = new Hono<AppEnv>();

type Row = {
  email: string;
  name: string | null;
  home_course: string | null;
  show_handicap: number;
  notify_games: number;
  handicap: number | null;
  created_at: string;
};

const toMember = (row: Row): Member => ({
  email: row.email,
  name: row.name ?? '',
  homeCourse: row.home_course,
  showHandicap: row.show_handicap === 1,
  notifyGames: row.notify_games === 1,
  handicap: row.handicap,
});

// Fixed map from API field to column. Only these names ever reach the SQL text.
const COLUMNS = {
  name: 'name',
  homeCourse: 'home_course',
  showHandicap: 'show_handicap',
  notifyGames: 'notify_games',
  handicap: 'handicap',
} as const;

const Update = MemberUpdate.extend({
  homeCourse: z.string().refine((code) => courseByCode(code) !== undefined, 'unknown course').nullable().optional(),
});

const one = (db: D1Database, email: string) =>
  db.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<Row>();

app.get('/me', async (c) => {
  const row = await one(c.env.DB, c.get('email'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(toMember(row));
});

app.put('/me', async (c) => {
  const parsed = Update.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const email = c.get('email');

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    sets.push(`${COLUMNS[key as keyof typeof COLUMNS]} = ?`);
    binds.push(typeof value === 'boolean' ? Number(value) : value);
  }
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE email = ?`)
      .bind(...binds, email).run();
  }
  const row = await one(c.env.DB, email);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(toMember(row));
});

app.get('/members', async (c) => {
  const email = c.get('email');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM members ORDER BY COALESCE(NULLIF(name, \'\'), email) COLLATE NOCASE',
  ).all<Row>();
  return c.json(results.map((row) => ({
    ...toMember(row),
    // Handicap is shared only if the member opted in; your own is always yours.
    handicap: row.show_handicap === 1 || row.email === email ? row.handicap : null,
  })));
});

export default app;
