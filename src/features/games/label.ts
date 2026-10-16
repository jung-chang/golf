// Game labels and small facts, shared by the Worker (push text) and the UI.
import { daysOut, nyToday } from '@/lib/nyc';
import { fmtMinutes, toMinutes } from '@/lib/teetimes';
import type { Game } from '@/schemas/group';

/** "Sat, Oct 18" for a YYYY-MM-DD date. */
export function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${wd}, ${md}`;
}

/** "CLR Sat Oct 18, 7:12am" (the first tee time). */
export function gameLabel(game: Pick<Game, 'code' | 'date' | 'times'>) {
  const [wd, md] = dayLabel(game.date).split(', ');
  return `${game.code} ${wd} ${md}, ${fmtMinutes(toMinutes(game.times[0].time))}`;
}

/** "7:12am" for one of a game's tee times. */
export const timeLabel = (t: { time: string }) => fmtMinutes(toMinutes(t.time));

export const ins = (game: Pick<Game, 'players'>) => game.players.filter((p) => p.status === 'in');

/** Spots across all the game's tee times. */
export const capacity = (game: Pick<Game, 'times'>) => game.times.reduce((n, t) => n + t.spots, 0);

/** Where a game is in its life, for the Games screen. */
export type Phase = 'upcoming' | 'today' | 'played';
export function phase(game: Pick<Game, 'date'>, today: string): Phase {
  return game.date > today ? 'upcoming' : game.date === today ? 'today' : 'played';
}

/** "in 3 days", "tomorrow", "in 2h 10m", "now" until a UTC tee time. */
export function countdown(teetime: string, now = Date.now()): string {
  const mins = Math.round((Date.parse(teetime) - now) / 60_000);
  if (mins <= 5) return mins < -15 ? 'teed off' : 'now';
  if (mins < 60) return `in ${mins}m`;
  const days = daysOut(nyToday(new Date(teetime)), new Date(now)); // calendar days, New York
  if (days === 0) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
