// Booking happens on TeeItUp, where you pay. The app opens the course's booking page for that day
// (you still select the exact time there), remembers what you went to book, and when you come back
// asks whether you did. TeeItUp's receipt goes to your email; the app never sees it.
import { api } from '@/lib/api';
import { bookingUrl, courseByCode } from '@/lib/nyc';
import type { Game } from '@/schemas/group';
import type { TeeTime } from '@/schemas/teetimes';

/** A tee time from search, enough to put it in a game. */
export type Slot = Pick<TeeTime, 'code' | 'facilityId' | 'date' | 'time' | 'teetime' | 'spots' | 'holes'>;

/** What you went to TeeItUp to book: a time in a game, or one straight from search. */
export type Pending = { at: number; code: string; date: string; time: string; teetime: string; gameId?: string; slot?: Slot };

const KEY = 'golf.booking';
const FRESH_MS = 3 * 60 * 60 * 1000; // after three hours, stop asking

export function openBooking(p: Omit<Pending, 'at'>) {
  const course = courseByCode(p.code);
  const url = course && bookingUrl(course, p.date);
  if (!url) return;
  try { localStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() })); } catch { /* still opens */ }
  window.open(url, '_blank', 'noopener');
}

export function pendingBooking(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Pending | null;
    if (p && Date.now() - p.at < FRESH_MS) return p;
    localStorage.removeItem(KEY);
  } catch { /* nothing pending */ }
  return null;
}

export function clearBooking() {
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}

/** The group's game at this course on this date, if there is one. */
export async function gameFor(slot: Pick<Slot, 'code' | 'date'>): Promise<Game | undefined> {
  const games = await api<Game[]>('/games');
  return games.find((g) => g.code === slot.code && g.date === slot.date);
}

const teeOf = (s: Slot) => ({ teetime: s.teetime, time: s.time, spots: Math.min(Math.max(s.spots, 1), 4) });

/** Propose a time: add it to an existing game, or start a new one. */
export function propose(slot: Slot, gameId: string | null, note?: string): Promise<Game> {
  if (gameId) return api<Game>(`/games/${gameId}/times`, { body: teeOf(slot) });
  return api<Game>('/games', {
    body: { code: slot.code, facilityId: slot.facilityId, date: slot.date, holes: slot.holes.includes(18) ? 18 : 9, ...teeOf(slot), note: note || undefined },
  });
}

/** You booked it: put it in a game (its own, the group's that day, or a new one) and mark it booked. */
export async function recordBooking(p: Pending): Promise<Game> {
  let gameId = p.gameId;
  if (!gameId && p.slot) {
    const existing = await gameFor(p.slot);
    gameId = existing?.times.some((t) => t.teetime === p.teetime) ? existing.id : (await propose(p.slot, existing?.id ?? null)).id;
  }
  if (!gameId) throw new Error('Nothing to book');
  return api<Game>(`/games/${gameId}/book`, { method: 'PUT', body: { teetime: p.teetime, booked: true } });
}
