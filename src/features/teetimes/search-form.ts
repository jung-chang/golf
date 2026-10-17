import { Criteria } from '@/schemas/teetimes';
import { addDays, courseByCode, MAX_DAYS, nyToday, weekdayOf } from '@/lib/nyc';
import type { Criteria as SearchCriteria } from '@/schemas/teetimes';

export type Form = SearchCriteria;
export const FULL_DAY: [number, number] = [300, 1200];
export const dateOptions = (today = nyToday()) => Array.from({ length: MAX_DAYS + 1 }, (_, i) => addDays(today, i));
export function defaultForm(today = nyToday()): Form {
  const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  return { dates: [saturday, addDays(saturday, 1)], golfers: [4], codes: [], holes18: true, holes: 18, window: [...FULL_DAY] };
}

const SavedForm = Criteria.extend({ dates: Criteria.shape.dates.min(0), codes: Criteria.shape.codes.min(0) });
/** Validate untrusted storage before using it in controls or API requests. */
export function restoreForm(value: unknown, today = nyToday()): Form {
  const fallback = defaultForm(today);
  const parsed = SavedForm.safeParse(value);
  if (!parsed.success) return fallback;
  const saved = parsed.data;
  const days = dateOptions(today);
  const dates = [...new Set(saved.dates.filter(d => days.includes(d)))].sort();
  return {
    ...saved, dates: dates.length ? dates : fallback.dates,
    golfers: saved.golfers.length ? [Math.min(...saved.golfers)] : [4],
    codes: [...new Set(saved.codes.filter(c => courseByCode(c)?.tenant))],
    holes: saved.holes ?? (saved.holes18 ? 18 : 9),
    window: saved.window[0] >= FULL_DAY[0] && saved.window[1] <= FULL_DAY[1] && saved.window[0] < saved.window[1] ? saved.window : [...FULL_DAY],
  };
}

/** Time narrows cached availability; these parameters require a new explicit search. */
export function needsSearch(form: Form, last: Form): boolean {
  return form.dates.join() !== last.dates.join()
    || form.golfers.join() !== last.golfers.join()
    || form.holes !== last.holes || form.holes18 !== last.holes18;
}
