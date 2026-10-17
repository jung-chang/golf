// Filtering shared by the results screen and the alert check.
import type { Criteria, TeeTime } from '../schemas/teetimes';

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

/** Times matching the criteria, earliest first. */
export function filterTimes(times: TeeTime[], c: Criteria): TeeTime[] {
  const min = c.golfers.length ? Math.min(...c.golfers) : 0;
  return times
    .filter((t) =>
      c.dates.includes(t.date)
      && c.codes.includes(t.code)
      && t.spots >= Math.max(1, min)
      && (c.holes ? t.holes.includes(c.holes) : !c.holes18 || t.holes.includes(18))
      && toMinutes(t.time) >= c.window[0]
      && toMinutes(t.time) <= c.window[1])
    .sort((a, b) => a.teetime.localeCompare(b.teetime) || a.code.localeCompare(b.code));
}
