import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { IconAction } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { courseByCode, NYC_COURSES, type NycCourse } from '@/lib/nyc';
import { cn } from '@/lib/utils';

const LIVE_COURSES = NYC_COURSES.filter((c) => c.tenant);
const REGIONS = [
  { borough: 'Bronx', color: 'bronx', cells: [['VCT', 1, 1], ['SPL', 2, 1], ['MOS', 1, 2], ['PEL', 2, 2]] },
  { borough: 'Queens', color: 'queens', cells: [['FLU', 3, 1], ['CLR', 4, 1], ['KIS', 3, 2], ['DGL', 4, 2], ['FOR', 4, 3]] },
  { borough: 'Staten Island', color: 'staten', cells: [['SLV', 1, 3], ['SSO', 1, 4], ['LTO', 2, 4]] },
  { borough: 'Brooklyn', color: 'brooklyn', cells: [['DYK', 3, 4], ['MPK', 4, 4]] },
] as const;

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

  const tile = (c: NycCourse, roomy = false, position?: { column: number; row: number }) => {
    const on = selected.includes(c.code);
    return (
      <button
        key={c.code}
        type="button"
        aria-label={`${c.name}, ${c.borough}${c.badge ? `, ${c.badge}` : ''}${c.tenant ? '' : ', no live tee times available'}`}
        aria-pressed={on}
        disabled={!c.tenant}
        style={position ? { gridColumn: position.column, gridRow: position.row } : undefined}
        onClick={() => onChange(on ? selected.filter((code) => code !== c.code) : [...selected, c.code])}
        className={cn(
          'course-tile relative flex min-h-11 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-2 py-2 text-left transition-colors active:scale-95',
          !c.tenant && 'cursor-not-allowed text-muted-foreground',
          roomy && 'min-h-20 bg-card px-3',
        )}
      >
        {c.badge && <span aria-hidden="true" className="course-badge absolute top-1.5 right-1.5 rounded px-1 text-[8px] leading-3 font-semibold">{c.badge === 'pitch & putt' ? 'P&P' : 'Short'}</span>}
        <span aria-hidden="true" className={cn('text-lg leading-tight font-extrabold tracking-wide', !c.tenant && 'opacity-60')}>{c.code}</span>
        <span className={cn('max-w-full truncate text-[10px] leading-tight', roomy && 'text-sm')}>{c.name}</span>
        {!c.tenant && <span className="text-[9px] leading-tight">No live times</span>}
      </button>
    );
  };

  return (
    <section className="space-y-2" aria-label="Course selection">
      <div className="flex min-h-11 items-center justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-base font-semibold">Courses</h2>
          <span className="text-xs text-muted-foreground">{chosen.length} selected</span>
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <IconAction ref={searchButton} label={searchOpen ? 'Close course search' : 'Search courses'} aria-expanded={searchOpen} aria-controls={searchId}
            className="text-primary" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>
            {searchOpen ? <X className="size-4" /> : <Search className="size-4" />}
          </IconAction>
          <Button type="button" variant="ghost" size="sm" aria-label="Select all courses" className="min-h-11 px-2 text-primary" onClick={() => onChange(LIVE_COURSES.map((c) => c.code))}>Select all</Button>
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
        <div className="course-picker-map space-y-2">
          <div className="relative isolate grid aspect-square grid-cols-4 grid-rows-4 gap-1 p-1">
            {REGIONS.map(region => <section key={region.borough} aria-label={region.borough} data-borough={region.color} className="contents">
              {region.cells.map(([code, column, row]) => tile(courseByCode(code)!, false, { column, row }))}
            </section>)}
            <div aria-hidden="true" className="pointer-events-none col-span-2 col-start-2 row-start-3 grid place-items-center text-foreground">
              <span className="course-picker-golfer block h-full max-h-24 w-full" />
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] font-medium text-muted-foreground" aria-label="Borough colors">
            {REGIONS.map(region => <span key={region.borough} className="flex items-center gap-1"><svg aria-hidden="true" width="9" height="4" viewBox="0 0 9 4"><path d="M2 2H7" strokeWidth="3" strokeLinecap="round" className={`course-outline-${region.color}`} /></svg>{region.borough}</span>)}
          </div>
        </div>
      )}

      <p aria-live="polite" className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        <span>{chosen.length ? chosen.map((c) => c.name).join(' · ') : 'Choose courses to search'}</span>
      </p>
    </section>
  );
}
