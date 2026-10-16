import { useEffect, useState } from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { NYC_COURSES, type Borough, type NycCourse } from '@/lib/nyc';
import { cn } from '@/lib/utils';
import type { Member } from '@/schemas/group';

const BOROUGHS: Borough[] = ['Bronx', 'Queens', 'Brooklyn', 'Staten Island'];

export function CoursePicker({ selected, onToggle }: { selected: string[]; onToggle: (code: string) => void }) {
  const [query, setQuery] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Borough[]>(['Queens']);
  useEffect(() => {
    let alive = true;
    api<Member>('/me').then((m) => {
      if (!alive) return;
      setMember(m);
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(`golf.favorites:${m.email}`) ?? '[]');
        if (Array.isArray(saved)) setFavorites(saved.filter((code): code is string => typeof code === 'string'));
      } catch { /* empty favorites */ }
      const home = NYC_COURSES.find((c) => c.code === m.homeCourse);
      if (home) setExpanded([home.borough]);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const favorite = (code: string) => {
    const next = favorites.includes(code) ? favorites.filter((c) => c !== code) : [...favorites, code];
    setFavorites(next);
    if (member) try { localStorage.setItem(`golf.favorites:${member.email}`, JSON.stringify(next)); } catch { /* works this visit */ }
  };
  const matches = NYC_COURSES.filter((c) => `${c.name} ${c.code} ${c.borough}`.toLowerCase().includes(query.toLowerCase().trim()));
  const preferred = matches.filter((c) => c.code === member?.homeCourse || favorites.includes(c.code));
  const row = (c: NycCourse) => {
    const on = selected.includes(c.code);
    const home = c.code === member?.homeCourse;
    return <div key={c.code} className={cn('flex items-center rounded-xl border bg-card', on && 'border-primary bg-accent')}>
      <button type="button" aria-pressed={on} disabled={!c.tenant} onClick={() => onToggle(c.code)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left">
        <span aria-hidden="true" className={cn('grid size-5 shrink-0 place-content-center rounded-md border border-input', on && 'border-primary bg-primary text-primary-foreground')}>{on && <Check className="size-4" />}</span>
        <span className="min-w-0"><span className="block text-base font-medium">{c.name}</span>
          <span className="block text-sm text-muted-foreground">{!c.tenant ? 'No live tee times available' : [home ? 'Home course' : c.borough, c.badge].filter(Boolean).join(' · ')}</span></span>
      </button>
      {c.tenant && <button type="button" aria-label={`${favorites.includes(c.code) ? 'Remove' : 'Add'} ${c.name} ${favorites.includes(c.code) ? 'from' : 'to'} favorites`} aria-pressed={favorites.includes(c.code)} disabled={!member}
        onClick={() => favorite(c.code)} className="grid size-11 shrink-0 place-content-center rounded-xl text-warning disabled:opacity-40"><Star className={cn('size-5', favorites.includes(c.code) && 'fill-current')} /></button>}
    </div>;
  };
  return <div className="space-y-3">
    <div className="relative"><Search aria-hidden="true" className="absolute top-3.5 left-3 size-5 text-muted-foreground" /><Input aria-label="Search courses" placeholder="Search course or borough" value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 rounded-xl pl-10 text-base" /></div>
    {preferred.length > 0 && <section className="space-y-2" aria-label="Home course and favorites"><h3 className="text-sm font-semibold">Home & favorites</h3>{preferred.map(row)}</section>}
    {BOROUGHS.map((borough) => {
      const courses = matches.filter((c) => c.borough === borough && !preferred.includes(c));
      if (!courses.length) return null;
      const open = !!query.trim() || expanded.includes(borough);
      return <section key={borough} className="space-y-2">
        <button type="button" aria-expanded={open} aria-controls={`courses-${borough.replaceAll(' ', '-')}`} onClick={() => setExpanded((bs) => bs.includes(borough) ? bs.filter((b) => b !== borough) : [...bs, borough])}
          className="flex min-h-12 w-full items-center justify-between rounded-xl px-1 text-left text-sm font-semibold">
          {borough}<span className="flex items-center gap-2 text-muted-foreground">{courses.filter((c) => selected.includes(c.code)).length || ''}<ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} /></span>
        </button>
        {open && <div id={`courses-${borough.replaceAll(' ', '-')}`} className="space-y-2">{courses.map(row)}</div>}
      </section>;
    })}
    {!matches.length && <p className="py-3 text-sm text-muted-foreground">No courses match. Try a different name or borough.</p>}
  </div>;
}
