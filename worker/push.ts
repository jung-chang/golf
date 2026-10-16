// Web push: each member's device subscriptions, and sending to them.
import { buildPushHTTPRequest } from '@pushforge/builder';
import { Hono } from 'hono';
import { z } from 'zod';
import { PushSub } from '../src/schemas/group';
import { bad } from './rounds';
import type { AppEnv, Env } from './env';

/** tag: a newer notification with the same tag replaces the older one instead of stacking. */
export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Send a web push to every device of these members. Never throws; drops dead subscriptions. */
export async function notify(env: Env, emails: string[], msg: PushMessage): Promise<void> {
  const { VAPID_PRIVATE_JWK: jwk, VAPID_CONTACT: contact } = env;
  if (!emails.length || !env.VAPID_PUBLIC_KEY || !jwk || !contact) return;
  try {
    const { results } = await env.DB.prepare(`SELECT endpoint, keys FROM push_subs WHERE email IN (${emails.map(() => '?').join(',')})`)
      .bind(...emails).all<{ endpoint: string; keys: string }>();
    await Promise.all(results.map(async (row) => {
      try {
        const req = await buildPushHTTPRequest({
          privateJWK: jwk,
          subscription: { endpoint: row.endpoint, keys: JSON.parse(row.keys) },
          message: { payload: msg, adminContact: contact },
        });
        const res = await fetch(req.endpoint, { method: 'POST', headers: req.headers, body: req.body });
        if (res.status === 404 || res.status === 410) {
          await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(row.endpoint).run();
        } else if (!res.ok) {
          console.warn('push failed', res.status);
        }
      } catch (err) {
        console.warn('push failed', err);
      }
    }));
  } catch (err) {
    console.warn('notify failed', err);
  }
}

const app = new Hono<AppEnv>();

app.get('/key', (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY ?? null }));

app.post('/', async (c) => {
  const parsed = PushSub.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  // A device that signs in as someone else takes over its subscription.
  await c.env.DB.prepare(
    'INSERT INTO push_subs (endpoint, email, keys) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET email = ?2, keys = ?3',
  ).bind(parsed.data.endpoint, c.get('email'), JSON.stringify(parsed.data.keys)).run();
  return c.json({ ok: true });
});

const Unsub = z.object({ endpoint: z.string() });

app.delete('/', async (c) => {
  const parsed = Unsub.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND email = ?')
    .bind(parsed.data.endpoint, c.get('email')).run();
  return c.json({ ok: true });
});

export default app;
