import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { dayLabel } from '@/features/games/label';
import { courseByCode } from '@/lib/nyc';
import { fmtMinutes } from '@/lib/teetimes';
import { cn } from '@/lib/utils';
import { dateOptions, FULL_DAY, type Form } from './search-form';

export function SearchParameters({ form, onChange, onWindow, pending = false, onSearch, loading = false, courses }: {
  form: Form; onChange: (patch: Partial<Form>) => void;
  onWindow?: (window: [number, number]) => void;
  pending?: boolean; onSearch?: () => void; loading?: boolean; courses?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const dateStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const strip = dateStrip.current;
    const selected = strip?.querySelector('input:checked')?.parentElement;
    if (strip && selected) strip.scrollLeft += selected.getBoundingClientRect().left - strip.getBoundingClientRect().left;
  }, [expanded]);
  const fullDay = form.window[0] === FULL_DAY[0] && form.window[1] === FULL_DAY[1];
  const holes = form.holes ?? (form.holes18 ? 18 : null);
  const dates = form.dates.length ? form.dates.map(dayLabel).join(' + ') : 'Choose dates';
  return <section className="search-parameters rounded-2xl border bg-card p-3" aria-label="Search parameters">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-medium">{dates}</h2>
        <p className="text-xs text-muted-foreground">{form.golfers[0] ?? 4} players · {holes ? `${holes} H` : '9/18 H'} · {fullDay ? 'Full day' : `${fmtMinutes(form.window[0])}–${fmtMinutes(form.window[1])}`}</p>
        {courses && <p className="text-xs text-muted-foreground">{courses.map(c => courseByCode(c)?.name ?? c).join(' · ')}</p>}
      </div>
      <Button type="button" variant="ghost" className="min-h-11 shrink-0 gap-1 px-2" aria-label={expanded ? 'Hide search parameters' : 'Edit search parameters'} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide' : 'Edit'}{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Button>
    </div>
    <div id={id} hidden={!expanded} className="mt-3 space-y-3 border-t pt-3">
      <fieldset>
        <legend className="mb-2 text-xs text-muted-foreground">Dates · up to 3</legend>
        <div ref={dateStrip} className="flex snap-x gap-1.5 overflow-x-auto p-1 [scrollbar-width:thin]" aria-label="Search dates">
          {dateOptions().map(d => {
            const selected = form.dates.includes(d);
            return <label key={d} className="search-choice relative w-14 shrink-0 snap-start">
              <input type="checkbox" name={`${id}-dates`} value={d} aria-label={dayLabel(d)} checked={selected} disabled={!selected && form.dates.length >= 3}
                onChange={() => onChange({ dates: selected ? form.dates.filter(x => x !== d) : [...form.dates, d].sort() })} className="sr-only peer" />
              <span className="flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-xs peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-disabled:opacity-40 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                <span>{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                <span className="text-lg font-medium">{Number(d.slice(8))}</span>
                <span className="text-[10px] opacity-75">{new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
              </span>
            </label>;
          })}
        </div>
        {!form.dates.length && <p role="alert" className="pt-1 text-xs text-destructive">Choose at least one date.</p>}
      </fieldset>
      <div className="search-round-players">
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">Round</legend>
          <div className="flex gap-1 rounded-xl border bg-background p-1">
            {([9, 18] as const).map(n => <label key={n} className="search-choice relative min-w-0 flex-1">
              <input type="radio" name={`${id}-holes`} aria-label={`${n} holes`} checked={holes === n} onChange={() => onChange({ holes: n, holes18: n === 18 })} className="sr-only peer" />
              <span className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg text-sm peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">{n} H</span>
            </label>)}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">Players</legend>
          <div className="relative isolate grid min-h-[54px] grid-cols-4 items-center before:absolute before:inset-x-5 before:top-1/2 before:-z-10 before:h-px before:bg-border">
            {[1, 2, 3, 4].map(n => <label key={n} className="search-choice relative flex min-h-11 min-w-11 items-center justify-center">
              <input type="radio" name={`${id}-players`} aria-label={`${n} ${n === 1 ? 'player' : 'players'}`} checked={(form.golfers[0] ?? 4) === n} onChange={() => onChange({ golfers: [n] })} className="sr-only peer" />
              <span className="grid size-8 place-items-center rounded-full border bg-background text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">{n}</span>
            </label>)}
          </div>
        </fieldset>
      </div>
      <fieldset>
        <legend className="text-xs text-muted-foreground">Tee-off window</legend>
        <p className="mb-2 text-right text-xs font-medium tabular-nums">{fmtMinutes(form.window[0])}–{fmtMinutes(form.window[1])}</p>
        <div className="grid grid-cols-[7fr_8fr] text-center text-xs text-muted-foreground" aria-hidden="true"><span>Morning</span><span className="border-l">Afternoon</span></div>
        <Slider min={FULL_DAY[0]} max={FULL_DAY[1]} step={15} minStepsBetweenThumbs={1} value={form.window} formatValue={fmtMinutes}
          onValueChange={([start, end]) => (onWindow ?? ((window) => onChange({ window })))([start, end])} aria-label="Tee-off time range" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-hidden="true"><span>5am</span><span>Noon</span><span>8pm</span></div>
      </fieldset>
    </div>
    {pending && <div className="mt-3 space-y-2 border-t pt-3">
      <p role="status" className="text-xs text-muted-foreground">Dates, holes or players changed. Results still use your previous search.</p>
      <Button type="button" className={cn('min-h-11 w-full', loading && 'opacity-70')} disabled={!form.dates.length || loading} onClick={() => { setExpanded(false); onSearch?.(); }}>Search with new parameters</Button>
    </div>}
  </section>;
}
