// Public SevenRooms widget availability, fixed to one venue. No holds or booking writes.
import { Hono } from 'hono';
import { z } from 'zod';
import { SimulatorSearch, type SimulatorSlot } from '../src/lib/simulators';
import { daysOut } from '../src/lib/nyc';
import type { AppEnv } from './env';

const Slot = z.looseObject({
  type: z.string(), time_iso: z.string(), utc_datetime: z.string().nullish(), duration: z.number().nullish(),
  public_time_slot_description: z.string().max(500).nullish(),
  cancellation_policy: z.string().max(4000).nullish(), require_credit_card: z.boolean().nullish(),
  is_requestable: z.boolean().nullish(), is_held: z.boolean().nullish(),
});
const Response = z.object({ status: z.literal(200), data: z.object({ availability: z.record(z.string(), z.array(z.object({ is_closed: z.boolean().optional(), times: z.array(Slot) }))) }) });

export function normalizeSimulatorSlots(raw: unknown, date: string, duration: number, now = new Date()): SimulatorSlot[] {
  const response = Response.parse(raw);
  if (!(date in response.data.availability)) throw new Error('Missing requested date');
  const slots = new Map<string, SimulatorSlot>();
  for (const group of response.data.availability[date]) {
    if (group.is_closed) continue;
    for (const slot of group.times) {
      if (slot.type !== 'book' || !slot.utc_datetime || slot.is_requestable || slot.is_held || slot.duration !== duration) continue;
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(slot.time_iso) || !slot.time_iso.startsWith(`${date} `)) continue;
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(slot.utc_datetime)) continue;
      const utc = `${slot.utc_datetime.replace(' ', 'T')}Z`;
      if (!Number.isFinite(Date.parse(utc)) || Date.parse(utc) <= now.getTime()) continue;
      const rate = slot.public_time_slot_description || 'See rate on SevenRooms';
      const time = slot.time_iso.slice(11, 16);
      slots.set(`${utc}|${rate}`, { date, time, utc, duration, rate, cancellation: slot.cancellation_policy || 'Review cancellation terms on SevenRooms.', cardRequired: slot.require_credit_card ?? true });
    }
  }
  return [...slots.values()].sort((a, b) => a.utc.localeCompare(b.utc) || a.rate.localeCompare(b.rate));
}

const app = new Hono<AppEnv>();
app.get('/', async c => {
  const parsed = SimulatorSearch.safeParse({ dates: (c.req.query('dates') ?? '').split(','), guests: Number(c.req.query('guests')), duration: Number(c.req.query('duration')) });
  if (!parsed.success || !parsed.data.dates.every(d => daysOut(d) >= 0 && daysOut(d) <= 14)) return c.json({ error: 'Choose 1–3 dates within 14 days, 1–6 guests, and a 30–240 minute session.' }, 400);
  const search = parsed.data;
  const results = await Promise.all([...new Set(search.dates)].map(async date => {
    try {
      const query = new URLSearchParams({ venue: 'golfzonsocialbrooklyn', time_slot: '12:00:00', party_size: String(search.guests), picked_duration: String(search.duration), halo_size_interval: '64', start_date: date, num_days: '1', channel: 'SEVENROOMS_WIDGET', selected_lang_code: 'en' });
      const response = await fetch(`https://www.sevenrooms.com/api-yoa/availability/ng/widget/range?${query}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('Provider unavailable');
      return { date, slots: normalizeSimulatorSlots(await response.json(), date, search.duration), failed: false };
    } catch { return { date, slots: [], failed: true }; }
  }));
  c.header('Cache-Control', 'no-store');
  return c.json({ slots: results.flatMap(r => r.slots), failedDates: results.filter(r => r.failed).map(r => r.date), fetchedAt: new Date().toISOString() });
});
export default app;
