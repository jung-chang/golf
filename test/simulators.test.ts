import { afterEach, describe, expect, it, vi } from 'vitest';
import app, { normalizeSimulatorSlots } from '../worker/simulators';
import { simulatorBookingUrl } from '../src/lib/simulators';
import { addDays, nyToday } from '../src/lib/nyc';

const now = new Date('2026-10-17T12:00:00Z');
const date = '2026-10-18';
const slot = { type: 'book', time_iso: `${date} 10:00:00`, utc_datetime: `${date} 14:00:00`, duration: 60, public_time_slot_description: '$99/Hour (Peak Golf)', require_credit_card: true };
const response = (times: unknown[]) => ({ status: 200, data: { availability: { [date]: [{ is_closed: false, times }] } } });
afterEach(() => vi.unstubAllGlobals());

describe('simulator provider', () => {
  it('keeps bookable rates distinct and excludes requests, holds, wrong durations and past times', () => {
    const slots = normalizeSimulatorSlots(response([slot, slot, { ...slot, public_time_slot_description: '$49/Hour (Special)' }, { ...slot, is_requestable: true }, { ...slot, is_held: true }, { ...slot, type: 'request', utc_datetime: null, duration: null, require_credit_card: null }, { ...slot, duration: 90 }]), date, 60, now);
    expect(slots).toHaveLength(2);
    expect(slots[0].cardRequired).toBe(true);
    expect(slots[0].utc).toBe('2026-10-18T14:00:00Z');
    expect(normalizeSimulatorSlots(response([slot]), date, 60, new Date('2026-10-19T00:00:00Z'))).toEqual([]);
    expect(slots[0]).not.toHaveProperty('access_persistent_id');
  });

  it('rejects changed or incomplete provider responses rather than claiming no availability', () => {
    expect(() => normalizeSimulatorSlots({ status: 500 }, date, 60, now)).toThrow();
    expect(() => normalizeSimulatorSlots({ status: 200, data: { availability: {} } }, date, 60, now)).toThrow();
  });

  it('hands off only non-personal booking preferences to the fixed venue', () => {
    const url = new URL(simulatorBookingUrl({ dates: [date], guests: 4, duration: 90 }, date, '10:00'));
    expect(url.origin).toBe('https://www.sevenrooms.com');
    expect(url.pathname).toContain('/golfzonsocialbrooklyn/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ date, party_size: '4', duration: '90', start_time: '10:00' });
  });

  it('bounds queries and reports upstream failures separately from empty results', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const validDate = addDays(nyToday(), 1);
    const bad = await app.request(`/?dates=${validDate}&guests=7&duration=60`);
    expect(bad.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const good = await app.request(`/?dates=${validDate}&guests=2&duration=60`);
    expect(await good.json()).toMatchObject({ slots: [], failedDates: [validDate] });
    expect(fetch.mock.calls[0][0]).toContain('venue=golfzonsocialbrooklyn');
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('method'); // read-only GET, never a hold or booking
    expect((await app.request('/', { method: 'POST' })).status).toBe(404);
  });
});
