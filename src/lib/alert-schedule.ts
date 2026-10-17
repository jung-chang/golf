import type { Alert } from '../schemas/group';
import { nyClock, nyToday } from './nyc';

/** Shared by the scheduler and its UI; all hours are America/New_York. */
export const CHECK_HOURS: Record<Alert['every'], number[]> = {
  1: Array.from({ length: 16 }, (_, i) => i + 6),
  4: [7, 11, 15, 19],
  12: [7, 19],
};

export function isDue(every: Alert['every'], now: Date): boolean {
  const { hour, minute } = nyClock(now);
  return minute < 15 && CHECK_HOURS[every].includes(hour);
}

type Schedule = Pick<Alert, 'every' | 'weekdays' | 'criteria' | 'paused'>;
export function nextAlertCheck(alert: Schedule, now = new Date()): string | null {
  if (alert.paused) return null;
  // Advance actual UTC ticks, so DST transitions cannot create nonexistent local times.
  for (let t = (Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000; t <= now.getTime() + 48 * 3_600_000; t += 3_600_000) {
    const tick = new Date(t);
    if (!alert.weekdays.length && !alert.criteria.dates.some(d => d >= nyToday(tick))) return null;
    if (isDue(alert.every, tick)) return tick.toISOString();
  }
  return null;
}

export function alertCheckLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = nyToday(date) === nyToday(now) ? 'Today' : date.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  return `${day} at ${date.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
}
