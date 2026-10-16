// Shot tracking sync: each member's rounds and bag.
import { Hono } from 'hono';
import { z } from 'zod';
import { Bag, Round } from '../src/schemas/round';
import type { AppEnv } from './env';

const app = new Hono<AppEnv>();

export const bad = (error: z.ZodError) => ({ error: 'invalid', issues: error.issues.slice(0, 10) });

app.get('/rounds', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT data FROM rounds WHERE email = ? ORDER BY date DESC')
    .bind(c.get('email')).all<{ data: string }>();
  return c.json(results.map((r) => JSON.parse(r.data)));
});

app.put('/rounds/:id', async (c) => {
  const parsed = Round.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const r = parsed.data;
  if (r.id !== c.req.param('id')) return c.json({ error: 'id mismatch' }, 400);
  // Keep whichever copy was edited last (phone and laptop may both have it).
  // The email check stops one member overwriting another's round.
  await c.env.DB.prepare(
    `INSERT INTO rounds (id, email, date, course_id, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET date = ?3, course_id = ?4, data = ?5, updated_at = ?6
     WHERE rounds.email = ?2 AND excluded.updated_at >= rounds.updated_at`,
  ).bind(r.id, c.get('email'), r.date, r.courseId, JSON.stringify(r), r.updatedAt).run();
  return c.json({ ok: true });
});

app.delete('/rounds/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM rounds WHERE id = ? AND email = ?').bind(c.req.param('id'), c.get('email')).run();
  return c.json({ ok: true });
});

app.get('/bag', async (c) => {
  const row = await c.env.DB.prepare("SELECT data FROM settings WHERE email = ? AND key = 'bag'").bind(c.get('email')).first<{ data: string }>();
  return c.json(row ? JSON.parse(row.data) : null);
});

app.put('/bag', async (c) => {
  const parsed = Bag.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  await c.env.DB.prepare("INSERT INTO settings (email, key, data) VALUES (?1, 'bag', ?2) ON CONFLICT(email, key) DO UPDATE SET data = ?2")
    .bind(c.get('email'), JSON.stringify(parsed.data)).run();
  return c.json({ ok: true });
});

export default app;
