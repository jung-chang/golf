// The Worker: static assets (the app) are served by Cloudflare before this runs;
// only /api/* reaches it. Every API call is tied to a member via Cloudflare Access.
import { Hono } from 'hono';
import { auth } from './auth';
import { nyToday } from '../src/lib/nyc';
import type { AppEnv, Env } from './env';
import alerts, { runAlerts } from './alerts';
import games, { remindGames } from './games';
import members from './members';
import push from './push';
import rounds from './rounds';
import teetimes from './teetimes';

const app = new Hono<AppEnv>().basePath('/api');
app.use('*', auth);
// "Sign in again": Access signs the member in on the way here, then they go back to the app.
app.get('/login', (c) => c.redirect('/'));
// Tab badges (upcoming games still waiting on my answer, alert times I haven't opened),
// and my game today, for the "Today" strip.
app.get('/badges', async (c) => {
  const email = c.get('email');
  const today = nyToday();
  const db = c.env.DB;
  const [games, alerts, next] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) AS n FROM games g
      WHERE g.status != 'cancelled' AND g.date >= ?2
        AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.email = ?1)`).bind(email, today),
    db.prepare('SELECT COALESCE(SUM(json_array_length(unread)), 0) AS n FROM alerts WHERE email = ? AND paused = 0').bind(email),
    db.prepare(`SELECT g.id, g.code, g.teetime FROM games g JOIN game_players gp ON gp.game_id = g.id AND gp.email = ?1 AND gp.status = 'in'
      WHERE g.status != 'cancelled' AND g.date = ?2 ORDER BY g.teetime LIMIT 1`).bind(email, today),
  ]);
  return c.json({
    games: Number(games.results[0]?.n ?? 0),
    alerts: Number(alerts.results[0]?.n ?? 0),
    today: next.results[0] ?? null, // { id, code, teetime } | null
  });
});
app.route('/tee-times', teetimes);
app.route('/games', games);
app.route('/alerts', alerts);
app.route('/push', push);
app.route('/', members); // /me, /members
app.route('/', rounds); // /rounds, /bag

export default {
  fetch: app.fetch,
  // Hourly cron: alerts due this hour (every 1, 4 or 12 hours), game reminders at 7am (New York time).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date(event.scheduledTime);
    ctx.waitUntil(Promise.all([runAlerts(env, now), remindGames(env, now)]));
  },
} satisfies ExportedHandler<Env>;
