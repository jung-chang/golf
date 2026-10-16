// Tee time alerts: per-member criteria, the cron check, and the alert routes.
import { Hono, type Context } from 'hono';
import { Alert, AlertUpdate, NewAlert } from '../src/schemas/group';
import { timeKey, type TeeTime, type TeeTimesResponse } from '../src/schemas/teetimes';
import { filterTimes, fmtMinutes, toMinutes } from '../src/lib/teetimes';
import { addDays, courseByCode, courseByFacility, daysOut, MAX_DAYS, nyClock, nyToday, weekdayOf } from '../src/lib/nyc';
import { bad } from './rounds';
import { notify } from './push';
import { getTeeTimes } from './teetimes';
import type { AppEnv, Env } from './env';

/** New York hours each frequency checks at; quiet overnight. */
export const CHECK_HOURS: Record<Alert['every'], number[]> = {
  1: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  4: [7, 11, 15, 19],
  12: [7, 19],
};

/** Whether an alert checked every `every` hours is due on this (hourly) cron tick. */
export function isDue(every: Alert['every'], now: Date): boolean {
  const { hour, minute } = nyClock(now);
  return minute < 15 && CHECK_HOURS[every].includes(hour);
}

/** The dates an alert watches that are still today or later. */
export function alertDates(alert: Pick<Alert, 'criteria' | 'weekdays'>, now = new Date()): string[] {
  if (!alert.weekdays.length) return alert.criteria.dates.filter((d) => daysOut(d, now) >= 0);
  const today = nyToday(now);
  return Array.from({ length: MAX_DAYS + 1 }, (_, i) => addDays(today, i)).filter((d) => alert.weekdays.includes(weekdayOf(d)));
}

/** Times matching the alert, split into new (not seen, or notified but not yet opened) and already seen. */
export function newMatches(times: TeeTime[], alert: Pick<Alert, 'criteria' | 'seen'> & { unread?: string[] }): { fresh: TeeTime[]; seen: TeeTime[] } {
  const known = new Set(alert.seen);
  const unread = new Set(alert.unread);
  const matches = filterTimes(times, alert.criteria);
  const isNew = (t: TeeTime) => !known.has(timeKey(t)) || unread.has(timeKey(t));
  return { fresh: matches.filter(isNew), seen: matches.filter((t) => !isNew(t)) };
}

/** New York date and tenant behind a timeKey, for matching it against failed fetches. */
function keySource(key: string): string | undefined {
  const [id, teetime] = key.split('|');
  const tenant = courseByFacility(Number(id))?.tenant;
  return tenant ? `${tenant}|${nyToday(new Date(teetime))}` : undefined;
}

/**
 * The seen set after a check: every time that matches now. A time that disappears
 * (booked) drops out, so if it comes back (a cancellation) it counts as new again.
 * Keys from a tenant/date that failed to load are kept, so a failed fetch never re-sends.
 */
export function nextSeen(seen: string[], matches: TeeTime[], errors: TeeTimesResponse['errors']): string[] {
  const failed = new Set(errors.map((e) => `${e.tenant}|${e.date}`));
  const keep = seen.filter((k) => failed.has(keySource(k) ?? ''));
  return [...new Set([...matches.map(timeKey), ...keep])];
}

type Row = {
  id: string; email: string; criteria: string; seen: string; weekdays: string; unread: string; every: number;
  paused: number; created_at: string; checked_at: string | null;
};

const toAlert = (r: Row): Alert => Alert.parse({
  id: r.id,
  criteria: JSON.parse(r.criteria),
  seen: JSON.parse(r.seen),
  weekdays: JSON.parse(r.weekdays ?? '[]'),
  every: r.every ?? 4,
  unread: JSON.parse(r.unread ?? '[]'),
  paused: !!r.paused,
  createdAt: r.created_at,
  checkedAt: r.checked_at,
});

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const describe = (t: TeeTime) => `${day(t.date)} ${fmtMinutes(toMinutes(t.time))} ${t.code} (${t.spots})`;

/** Called by the hourly cron; checks the alerts that are due this hour (New York time). */
export async function runAlerts(env: Env, now: Date): Promise<void> {
  if (!Object.values(CHECK_HOURS).some((hours) => hours.includes(nyClock(now).hour))) return;
  const { results } = await env.DB.prepare('SELECT * FROM alerts WHERE paused = 0').all<Row>();
  const all = results
    .map((row) => ({ row, alert: toAlert(row) }))
    .map((w) => ({ ...w, live: alertDates(w.alert, now) }));

  // Fixed-date alerts whose dates have all passed pause themselves.
  for (const { alert } of all.filter((w) => !w.live.length)) {
    await env.DB.prepare('UPDATE alerts SET paused = 1 WHERE id = ?').bind(alert.id).run();
  }
  const work = all.filter((w) => w.live.length && isDue(w.alert.every, now));
  if (!work.length) return;

  const dates = [...new Set(work.flatMap((w) => w.live))];
  const codes = [...new Set(work.flatMap((w) => w.alert.criteria.codes))].filter((code) => courseByCode(code)?.tenant);
  const { times, errors }: Pick<TeeTimesResponse, 'times' | 'errors'> = codes.length
    ? await getTeeTimes(dates, codes, { force: true })
    : { times: [], errors: [] };

  const checkedAt = now.toISOString();
  for (const { row, alert, live } of work) {
    const criteria = { ...alert.criteria, dates: live };
    const matches = filterTimes(times, criteria);
    const known = new Set(alert.seen);
    // First check of a repeating alert: times on the weeks it wasn't set up from are already there, not new.
    const firstCheck = !alert.checkedAt && alert.weekdays.length > 0;
    const fresh = matches.filter((t) => !known.has(timeKey(t)) && !(firstCheck && !alert.criteria.dates.includes(t.date)));
    const listed = new Set(matches.map(timeKey));
    const unread = [...new Set([...alert.unread.filter((k) => listed.has(k)), ...fresh.map(timeKey)])];
    if (fresh.length) {
      const shown = fresh.slice(0, 4).map(describe);
      if (fresh.length > 4) shown.push(`+${fresh.length - 4} more`);
      const n = fresh.length;
      await notify(env, [row.email], {
        title: `${n} new tee time${n === 1 ? '' : 's'}`,
        body: shown.join(' · '),
        url: `/#alerts/${alert.id}`,
        tag: `alert-${alert.id}`,
      });
    }
    await env.DB.prepare('UPDATE alerts SET seen = ?1, unread = ?2, checked_at = ?3 WHERE id = ?4')
      .bind(JSON.stringify(nextSeen(alert.seen, matches, errors)), JSON.stringify(unread), checkedAt, alert.id).run();
  }
}

const app = new Hono<AppEnv>();

const owned = (c: Context<AppEnv>, id: string) =>
  c.env.DB.prepare('SELECT * FROM alerts WHERE id = ? AND email = ?').bind(id, c.get('email')).first<Row>();

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM alerts WHERE email = ? ORDER BY created_at DESC')
    .bind(c.get('email')).all<Row>();
  return c.json(results.map(toAlert));
});

app.post('/', async (c) => {
  const parsed = NewAlert.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const alert: Alert = {
    id: crypto.randomUUID(),
    criteria: parsed.data.criteria,
    seen: parsed.data.seen,
    weekdays: parsed.data.weekdays,
    every: parsed.data.every,
    unread: [],
    paused: false,
    createdAt: new Date().toISOString(),
    checkedAt: null,
  };
  await c.env.DB.prepare(`INSERT INTO alerts (id, email, criteria, seen, weekdays, every, unread, paused, created_at, checked_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', 0, ?7, NULL)`)
    .bind(alert.id, c.get('email'), JSON.stringify(alert.criteria), JSON.stringify(alert.seen), JSON.stringify(alert.weekdays), alert.every, alert.createdAt).run();
  return c.json(alert);
});

app.put('/:id', async (c) => {
  const parsed = AlertUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const id = c.req.param('id');
  const row = await owned(c, id);
  if (!row) return c.json({ error: 'not found' }, 404);

  // Only the fields sent are written, so a save never overwrites what the cron just marked seen.
  const u = parsed.data;
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (u.criteria) { sets.push('criteria = ?'); vals.push(JSON.stringify(u.criteria)); }
  if (u.seen) { sets.push('seen = ?'); vals.push(JSON.stringify(u.seen)); }
  // New repeat days: the next check takes stock quietly again (see runAlerts).
  if (u.weekdays && JSON.stringify(u.weekdays) !== row.weekdays) {
    sets.push('weekdays = ?', 'checked_at = NULL');
    vals.push(JSON.stringify(u.weekdays));
  }
  if (u.every) { sets.push('every = ?'); vals.push(u.every); }
  if (u.paused !== undefined) { sets.push('paused = ?'); vals.push(u.paused ? 1 : 0); }
  if (u.read) sets.push("unread = '[]'");
  if (sets.length) {
    await c.env.DB.prepare(`UPDATE alerts SET ${sets.join(', ')} WHERE id = ? AND email = ?`)
      .bind(...vals, id, c.get('email')).run();
  }
  return c.json(toAlert((await owned(c, id))!));
});

app.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM alerts WHERE id = ? AND email = ?').bind(c.req.param('id'), c.get('email')).run();
  return c.json({ ok: true });
});

app.get('/:id/matches', async (c) => {
  const row = await owned(c, c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  const alert = toAlert(row);
  const dates = alertDates(alert);
  const codes = alert.criteria.codes.filter((code) => courseByCode(code)?.tenant);
  if (!dates.length || !codes.length) return c.json({ fresh: [], seen: [] });
  const { times } = await getTeeTimes(dates, codes, { force: c.req.query('force') === '1' });
  return c.json(newMatches(times, { criteria: { ...alert.criteria, dates }, seen: alert.seen, unread: alert.unread }));
});

export default app;
