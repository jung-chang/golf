// One event per game, shared by the .ics file (Apple Calendar) and the Google Calendar link.
import { courseByCode } from '@/lib/nyc';
import type { Game } from '@/schemas/group';
import { ins, timeLabel } from './label';

export function gameEvent(game: Game) {
  const name = courseByCode(game.code)?.name ?? game.code;
  const teeTimes = game.times.length > 1 ? `Tee times ${game.times.map(timeLabel).join(', ')}\n` : '';
  const who = ins(game).map((p) => p.name).join(', ');
  return {
    title: `Golf: ${name} (${game.holes} holes)`,
    location: `${name} Golf Course, New York`,
    details: `${teeTimes}With ${who || 'the group'}${game.note ? `\n${game.note}` : ''}`,
    start: new Date(game.times[0].teetime),
    // Last tee time plus a round: 4½ hours for 18, half that for 9.
    end: new Date(Date.parse(game.times.at(-1)!.teetime) + (game.holes === 18 ? 270 : 135) * 60_000),
  };
}

// 20261018T111200Z
export const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleCalendarUrl(game: Game) {
  const e = gameEvent(game);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${icsStamp(e.start)}/${icsStamp(e.end)}`, location: e.location, details: e.details });
  return `https://calendar.google.com/calendar/render?${q}`;
}
