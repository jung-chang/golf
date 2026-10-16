import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { IconAction } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { courseByCode, NYC_COURSES, PICKER, type NycCourse } from '@/lib/nyc';
import { cn } from '@/lib/utils';

const LIVE_COURSES = NYC_COURSES.filter((c) => c.tenant);

/** Four borough panels meet at Manhattan, with course search available on demand. */
export function CoursePicker({ selected, onChange }: { selected: string[]; onChange: (codes: string[]) => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const filter = query.trim().toLowerCase();
  const chosen = LIVE_COURSES.filter((c) => selected.includes(c.code));
  const matches = NYC_COURSES.filter((c) => `${c.name} ${c.code} ${c.borough}`.toLowerCase().includes(filter));

  useEffect(() => {
    if (searchOpen) input.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searchButton.current?.focus();
  };

  const tile = (c: NycCourse, roomy = false) => {
    const on = selected.includes(c.code);
    return (
      <button
        key={c.code}
        type="button"
        aria-label={`${c.name}, ${c.borough}${c.badge ? `, ${c.badge}` : ''}${c.tenant ? '' : ', no live tee times available'}`}
        aria-pressed={on}
        disabled={!c.tenant}
        onClick={() => onChange(on ? selected.filter((code) => code !== c.code) : [...selected, c.code])}
        className={cn(
          'relative flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border bg-card px-0.5 py-2 text-center transition-colors active:scale-95',
          c.badge && 'border-dashed',
          !c.tenant && 'cursor-not-allowed text-muted-foreground',
          on && 'border-primary bg-primary text-primary-foreground',
          roomy && 'min-h-20 px-3',
        )}
      >
        <span aria-hidden="true" className={cn('text-lg leading-tight font-extrabold tracking-wide', !c.tenant && 'opacity-60')}>{c.code}</span>
        <span className={cn('max-w-full text-[11px] leading-tight tracking-tight wrap-anywhere', roomy && 'text-sm tracking-normal')}>{c.name}</span>
        {!c.tenant && <span className="text-[11px] leading-tight">No live times</span>}
      </button>
    );
  };

  const panel = (i: number) => {
    const { borough, rows } = PICKER[i];
    return (
      <section key={borough} aria-label={borough} className={cn('relative min-w-0 rounded-[22px] border-2 border-primary px-1 pt-7 pb-2', i >= 2 && 'pt-8')}>
        <h3 className={cn('absolute top-2 right-2.5 left-2.5 text-[10px] leading-tight font-semibold tracking-[0.1em] text-muted-foreground uppercase', i % 2 === 1 && 'text-right')}>
          {borough}
        </h3>
        <div className="grid grid-cols-2 content-start gap-1">
          {rows.flat().map((code, j) => {
            const course = code ? courseByCode(code) : undefined;
            return course ? tile(course) : <div key={`empty-${j}`} aria-hidden="true" />;
          })}
        </div>
      </section>
    );
  };

  return (
    <section className="space-y-2" aria-label="Course selection">
      <div className="flex min-h-11 items-center justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold">Where</h2>
          <span className="text-xs text-muted-foreground">{chosen.length} selected</span>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <IconAction ref={searchButton} label={searchOpen ? 'Close course search' : 'Search courses'} aria-expanded={searchOpen} aria-controls={searchId}
            className="text-primary" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>
            {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
          </IconAction>
          <Button type="button" variant="ghost" size="sm" aria-label="Select all courses" className="min-h-11 px-2 text-primary" onClick={() => onChange(LIVE_COURSES.map((c) => c.code))}>All</Button>
          <Button type="button" variant="ghost" size="sm" aria-label="Clear courses" className="min-h-11 px-2 text-primary" onClick={() => onChange([])}>Clear</Button>
        </div>
      </div>

      <div id={searchId} hidden={!searchOpen} className="relative pb-1">
        <Search aria-hidden="true" className="absolute top-3.5 left-3 size-5 text-muted-foreground" />
        <Input ref={input} type="search" aria-label="Search courses" placeholder="Find a course or borough" value={query}
          onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } }}
          className="h-12 rounded-xl bg-card pl-10 text-base md:text-base" />
      </div>

      {filter ? (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">{matches.length ? `${matches.length} ${matches.length === 1 ? 'course' : 'courses'} found` : 'No courses match. Try a different name or borough.'}</p>
          <div className="grid grid-cols-2 gap-2">{matches.map((c) => tile(c, true))}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">{panel(0)}{panel(1)}</div>
          <div className="relative grid grid-cols-2 gap-2.5">
            {panel(2)}{panel(3)}
            <div aria-hidden="true" className="pointer-events-none absolute -top-1.5 left-1/2 grid size-[52px] -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full border-2 border-primary bg-background text-center text-[8px] leading-tight font-bold tracking-[0.1em] text-primary ring-[6px] ring-background">
              MAN<br />HATTAN
            </div>
          </div>
          <p className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span aria-hidden="true" className="h-3 w-4 rounded-sm border border-dashed border-muted-foreground" />
            Short course or pitch &amp; putt
          </p>
        </div>
      )}

      <p aria-live="polite" className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        <span>{chosen.length ? chosen.map((c) => c.name).join(' · ') : 'Choose courses to search'}</span>
      </p>
    </section>
  );
}
