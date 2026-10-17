import { z } from 'zod';

export const GOLFZON = { name: 'Golfzon Social Brooklyn', address: '15 Hoyt Street, Brooklyn', booking: 'https://www.sevenrooms.com/explore/golfzonsocialbrooklyn/reservations/create/search' };
export const SimulatorSearch = z.object({
  dates: z.array(z.iso.date()).min(1).max(3),
  guests: z.number().int().min(1).max(6),
  duration: z.number().int().min(30).max(240).multipleOf(30),
});
export type SimulatorSearch = z.infer<typeof SimulatorSearch>;
export type SimulatorSlot = { date: string; time: string; utc: string; duration: number; rate: string; cancellation: string; cardRequired: boolean };
export type SimulatorResults = { slots: SimulatorSlot[]; failedDates: string[]; fetchedAt: string };

/** Handoff only: the provider still selects the rate and confirms the reservation. */
export function simulatorBookingUrl(search: SimulatorSearch, date: string, time: string): string {
  const url = new URL(GOLFZON.booking);
  url.search = new URLSearchParams({ date, party_size: String(search.guests), duration: String(search.duration), start_time: time }).toString();
  return url.href;
}
