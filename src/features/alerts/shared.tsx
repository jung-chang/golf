// Formatting shared by the alert setup dialog and the Alerts tab.
import { Badge } from '@/components/ui/badge';
import { daysOut } from '@/lib/nyc';
import { openBooking } from '@/features/games/booking';
import { fmtMinutes, toMinutes } from '@/lib/teetimes';
import type { Alert } from '@/schemas/group';
import type { Criteria, TeeTime } from '@/schemas/teetimes';

/** "Sat Oct 18" */
export const dateLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');

export const timeLabel = (t: TeeTime) => fmtMinutes(toMinutes(t.time));

export const holesLabel = (holes18: boolean) => (holes18 ? '18 holes' : '9 or 18');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Every Sat, Sun" (week starting Monday). */
export const repeatLabel = (weekdays: number[]) =>
  `Every ${[...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join(', ')}`;

/** Check frequencies offered, and when each one runs (New York time). */
export const EVERY_OPTIONS: { value: Alert['every']; label: string; hint: string }[] = [
  { value: 1, label: 'Every hour', hint: '6am to 9pm' },
  { value: 4, label: 'Every 4 hours', hint: '7am, 11am, 3pm, 7pm' },
  { value: 12, label: 'Every 12 hours', hint: '7am and 7pm' },
];
export const everyLabel = (every: Alert['every']) => (every === 1 ? 'hourly' : `every ${every}h`);

export const windowLabel = ([start, end]: Criteria['window']) => `${fmtMinutes(start)} to ${fmtMinutes(end)}`;

/** Read-only criteria: dates, golfers, courses, holes and window. Past dates are struck through. */
export function CriteriaSummary({ criteria, weekdays = [] }: { criteria: Criteria; weekdays?: number[] }) {
  const allPast = !weekdays.length && criteria.dates.every((d) => daysOut(d) < 0);
  return (
    <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Dates</dt>
      <dd className="flex flex-wrap items-center gap-x-2">
        {weekdays.length > 0 && repeatLabel(weekdays)}
        {!weekdays.length && criteria.dates.map((d) => (
          <span key={d} className={daysOut(d) < 0 ? 'text-muted-foreground line-through' : undefined}>{dateLabel(d)}</span>
        ))}
        {allPast && <Badge variant="secondary">Expired</Badge>}
      </dd>
      <dt className="text-muted-foreground">Golfers</dt>
      <dd>{criteria.golfers.length ? criteria.golfers.join(' or ') : 'any'}</dd>
      <dt className="text-muted-foreground">Courses</dt>
      <dd>{criteria.codes.join(', ')}</dd>
      <dt className="text-muted-foreground">Holes</dt>
      <dd>{holesLabel(criteria.holes18)}</dd>
      <dt className="text-muted-foreground">Window</dt>
      <dd>{windowLabel(criteria.window)}</dd>
    </dl>
  );
}

/** One matching time. With `link`, tapping it opens TeeItUp (and asks "Did you book it?" on return). */
export function TimeRow({ t, label, link }: { t: TeeTime; label?: string; link?: boolean }) {
  const body = (
    <>
      <span className="font-medium tabular-nums">{dateLabel(t.date)} {timeLabel(t)}</span>
      <span className="text-muted-foreground">{t.code} · {t.spots} {t.spots === 1 ? 'spot' : 'spots'}</span>
      {label && <Badge variant={label === 'New' ? 'default' : 'outline'} className="ml-auto">{label}</Badge>}
    </>
  );
  const cls = 'flex min-h-11 items-center gap-2 px-1 text-sm';
  return link
    ? (
      <button type="button" className={`${cls} w-full rounded-md text-left hover:bg-accent`}
        onClick={() => openBooking({ code: t.code, date: t.date, time: t.time, teetime: t.teetime, slot: t })}>
        {body}
      </button>
    )
    : <div className={cls}>{body}</div>;
}
