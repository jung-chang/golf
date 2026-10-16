// Live tee times from TeeItUp/Kenna: one request per booking system and date, cached with the Cache API.
import { Hono } from 'hono';
import { z } from 'zod';
import { Criteria, TeeTime, TeeTimesResponse, timeKey } from '../src/schemas/teetimes';
import { KENNA_URL, MAX_DAYS, NYC_COURSES, canBook, courseByCode, courseByFacility, daysOut, type Tenant } from '../src/lib/nyc';
import type { AppEnv } from './env';

export type { Criteria };

const Kenna = z.array(
  z.looseObject({
    teetimes: z.array(
      z.looseObject({
        teetime: z.string(),
        maxPlayers: z.number(),
        rates: z
          .array(
            z.looseObject({
              holes: z.number().optional(),
              golfnow: z.looseObject({ GolfFacilityId: z.number().optional() }).optional(),
              greenFeeWalking: z.number().optional(),
              greenFeeCart: z.number().optional(),
            }),
          )
          .default([]),
      }),
    ),
  }),
);

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Kenna response (array per facility) to one row per course and time. Throws if the shape is wrong. */
export function normalize(raw: unknown): TeeTime[] {
  const seen = new Map<string, TeeTime>();
  for (const group of Kenna.parse(raw)) {
    for (const t of group.teetimes) {
      const facilityId = t.rates.map((r) => r.golfnow?.GolfFacilityId).find((id) => id !== undefined);
      if (facilityId === undefined) continue;
      const course = courseByFacility(facilityId);
      if (!course || facilityId === 20170 || facilityId === 4088 || t.maxPlayers < 1) continue;

      const prices = t.rates.flatMap((r) => [r.greenFeeWalking, r.greenFeeCart]).filter((p): p is number => !!p && p > 0);
      const p = Object.fromEntries(NY.formatToParts(new Date(t.teetime)).map((x) => [x.type, x.value]));
      const time: TeeTime = {
        code: course.code,
        facilityId,
        date: `${p.year}-${p.month}-${p.day}`,
        time: `${p.hour}:${p.minute}`,
        teetime: t.teetime,
        spots: t.maxPlayers,
        holes: [...new Set(t.rates.map((r) => r.holes).filter((h): h is number => h !== undefined))].sort((a, b) => a - b),
        priceCents: prices.length ? Math.min(...prices) : null,
      };
      if (!seen.has(timeKey(time))) seen.set(timeKey(time), time);
    }
  }
  return [...seen.values()];
}

/** Results for today and tomorrow expire after 2 minutes, later dates after 10. */
export const ttlSeconds = (date: string, now = new Date()) => (daysOut(date, now) <= 1 ? 120 : 600);

type Entry = { fetchedAt: string; times: TeeTime[] };

/** undefined = nothing bookable for this tenant on this date; 'error' = failed (never guessed). */
async function fetchTenant(tenant: Tenant, date: string, { force }: { force?: boolean }): Promise<Entry | 'error' | undefined> {
  const ids = NYC_COURSES.flatMap((c) => (c.tenant === tenant && c.facilityId && canBook(c, date) ? [c.facilityId] : []));
  if (!ids.length) return undefined;

  const cache = typeof caches !== 'undefined' ? (caches as CacheStorage & { default: Cache }).default : undefined;
  const key = new Request(`https://tee-cache.internal/${tenant}/${date}`);
  if (cache && !force) {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()) as Entry;
  }

  try {
    const res = await fetch(`${KENNA_URL}?date=${date}&facilityIds=${ids.join(',')}`, {
      headers: { 'x-be-alias': tenant, 'User-Agent': 'nyc-tee-times group app' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return 'error';
    const entry: Entry = { fetchedAt: new Date().toISOString(), times: normalize(await res.json()) };
    await cache?.put(key, new Response(JSON.stringify(entry), { headers: { 'Cache-Control': `max-age=${ttlSeconds(date)}` } }));
    return entry;
  } catch {
    return 'error';
  }
}

/** Live tee times for these dates and course codes (cached ≤10 min; force skips the cache). */
export async function getTeeTimes(dates: string[], codes: string[], { force = false }: { force?: boolean } = {}): Promise<TeeTimesResponse> {
  const tenants = [...new Set(NYC_COURSES.filter((c) => codes.includes(c.code)).map((c) => c.tenant))].filter((t): t is Tenant => !!t);
  const pairs = tenants.flatMap((tenant) => dates.map((date) => ({ tenant, date })));
  const results = await Promise.all(pairs.map(async (p) => ({ ...p, entry: await fetchTenant(p.tenant, p.date, { force }) })));

  const times: TeeTime[] = [];
  const fetched: Record<string, string> = {};
  const errors: TeeTimesResponse['errors'] = [];
  for (const { tenant, date, entry } of results) {
    if (entry === undefined) continue;
    if (entry === 'error') {
      errors.push({ tenant, date });
      continue;
    }
    fetched[`${tenant}|${date}`] = entry.fetchedAt;
    times.push(...entry.times.filter((t) => codes.includes(t.code)));
  }
  times.sort((a, b) => a.teetime.localeCompare(b.teetime) || a.code.localeCompare(b.code));
  return { times, fetched, errors };
}

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  const dates = (c.req.query('dates') ?? '').split(',').filter(Boolean);
  const codes = (c.req.query('codes') ?? '').split(',').filter(Boolean);
  if (!Criteria.shape.dates.safeParse(dates).success || !dates.every((d) => daysOut(d) >= 0 && daysOut(d) <= MAX_DAYS)) {
    return c.json({ error: 'dates: 1-3 YYYY-MM-DD dates within 14 days' }, 400);
  }
  if (!codes.length || !codes.every((code) => courseByCode(code))) return c.json({ error: 'codes: unknown course code' }, 400);

  const body = await getTeeTimes(dates, codes, { force: c.req.query('force') === '1' });
  c.header('Cache-Control', 'no-store');
  return c.json(body);
});

export default app;
