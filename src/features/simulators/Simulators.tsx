import { useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Slider } from '@/components/ui/slider';
import { api } from '@/lib/api';
import { addDays, nyToday } from '@/lib/nyc';
import { fmtMinutes, toMinutes } from '@/lib/teetimes';
import { GOLFZON, simulatorBookingUrl, type SimulatorSearch, type SimulatorResults, type SimulatorSlot } from '@/lib/simulators';
import { cn } from '@/lib/utils';
import { dayLabel } from '@/features/games/label';

export function SearchModes({ simulators = false }: { simulators?: boolean }) {
  return <nav aria-label="Search type" className="mx-4 mb-1 flex gap-4 text-sm">
    {[['Courses', '#', !simulators], ['Simulators', '#simulators', simulators]].map(([label, href, active]) => <a key={String(label)} href={String(href)} aria-current={active ? 'page' : undefined} className={cn('inline-flex min-h-9 items-center border-b-2 border-transparent text-muted-foreground', active && 'border-primary font-medium text-foreground')}>{label}</a>)}
  </nav>;
}

export function Simulators() {
  const [search, setSearch] = useState<SimulatorSearch>({ dates: [nyToday()], guests: 2, duration: 60 });
  const [window, setWindow] = useState<[number, number]>([540, 1320]);
  const [results, setResults] = useState<SimulatorResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SimulatorSlot | null>(null);
  const sequence = useRef(0);
  const change = (patch: Partial<SimulatorSearch>) => {
    sequence.current++;
    setSearch(s => ({ ...s, ...patch }));
    setResults(null); setPicked(null); setLoading(false); setError(null);
  };
  const find = async () => {
    const id = ++sequence.current;
    setLoading(true); setError(null); setResults(null);
    try {
      const data = await api<SimulatorResults>(`/simulators?${new URLSearchParams({ dates: search.dates.join(','), guests: String(search.guests), duration: String(search.duration) })}`);
      if (id === sequence.current) setResults(data);
    } catch { if (id === sequence.current) setError('Couldn’t check availability. Try again or check SevenRooms directly.'); }
    finally { if (id === sequence.current) setLoading(false); }
  };
  const slots = results?.slots.filter(s => toMinutes(s.time) >= window[0] && toMinutes(s.time) <= window[1]) ?? [];
  const selectClass = 'min-h-12 w-full min-w-0 rounded-xl border bg-card px-3 text-base';
  return <div className="pb-6">
    <PageHeader title="Simulators" sub="Find a bay, then confirm your booking" />
    <SearchModes simulators />
    <div className="space-y-4 px-4">
      <div><h1 className="font-semibold">{GOLFZON.name}</h1><p className="text-sm text-muted-foreground">{GOLFZON.address} · One bay · Up to 6 guests</p></div>
      <form onSubmit={e => { e.preventDefault(); void find(); }} className="space-y-3">
        <label className="grid gap-1 text-sm font-medium">Date<input aria-label="Simulator date" type="date" required min={nyToday()} max={addDays(nyToday(), 14)} value={search.dates[0]} onChange={e => change({ dates: [e.target.value] })} className={selectClass} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm font-medium">Guests<select value={search.guests} onChange={e => change({ guests: Number(e.target.value) })} className={selectClass}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Duration<select value={search.duration} onChange={e => change({ duration: Number(e.target.value) })} className={selectClass}>{[30, 60, 90, 120, 150, 180, 210, 240].map(n => <option key={n} value={n}>{n} minutes</option>)}</select></label>
        </div>
        <div><div className="flex justify-between text-sm"><span>Start time range</span><span className="tabular-nums">{fmtMinutes(window[0])}–{fmtMinutes(window[1])}</span></div><Slider min={0} max={1410} step={30} value={window} formatValue={fmtMinutes} aria-label="Filter simulator start times" onValueChange={([a, b]) => setWindow([a, b])} /></div>
        <Button type="submit" disabled={loading} className="min-h-12 w-full rounded-xl">{loading ? <><Loader2 className="animate-spin" />Checking…</> : 'Find simulator times'}</Button>
      </form>
      <p className="text-xs text-muted-foreground">Rates are per bay, not per person. Final price, card requirements, and cancellation terms are confirmed on SevenRooms.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!!results?.failedDates.length && <p role="alert" className="text-sm text-destructive">Availability couldn’t be verified. Check SevenRooms directly.</p>}
      {results && !results.failedDates.length && <section aria-label="Simulator availability" className="space-y-2">
        <h2 className="text-sm font-semibold">{dayLabel(search.dates[0])} · {slots.length} options</h2>
        <p className="text-xs text-muted-foreground">Checked {new Date(results.fetchedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET · Availability can change</p>
        {slots.length ? <div className="grid grid-cols-2 gap-2">{slots.map(s => <button key={`${s.utc}|${s.rate}`} onClick={() => setPicked(s)} className="min-h-20 rounded-xl border bg-card p-3 text-left active:bg-accent"><span className="block font-bold">{fmtMinutes(toMinutes(s.time))}</span><span className="block text-xs text-muted-foreground">{s.rate}</span></button>)}</div> : <p className="rounded-xl border p-4 text-sm text-muted-foreground">No matching times. Widen the start time range or try another date or duration.</p>}
      </section>}
      <a href={simulatorBookingUrl(search, search.dates[0], `${String(Math.floor(window[0] / 60)).padStart(2, '0')}:${String(window[0] % 60).padStart(2, '0')}`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary">Check SevenRooms directly <ExternalLink className="size-4" /></a>
    </div>
    <Drawer open={!!picked} onOpenChange={open => { if (!open) setPicked(null); }}><DrawerContent>
      <DrawerHeader><DrawerTitle>Review your bay request</DrawerTitle><DrawerDescription>{GOLFZON.name} · {picked && dayLabel(picked.date)}</DrawerDescription></DrawerHeader>
      {picked && <><div className="space-y-3 overflow-y-auto px-5 text-sm"><p className="font-semibold">{fmtMinutes(toMinutes(picked.time))} · {picked.duration} minutes · {search.guests} guests · One bay</p><p>{picked.rate} · Final total on SevenRooms</p>{picked.cardRequired && <p>A credit card is required by the venue.</p>}<p>{picked.cancellation}</p><p className="text-muted-foreground">No reservation yet. Select this time and rate on SevenRooms, review the final price and terms, then confirm there.</p></div><DrawerFooter><Button asChild className="min-h-12 rounded-xl"><a href={simulatorBookingUrl(search, picked.date, picked.time)} target="_blank" rel="noopener noreferrer">Continue to SevenRooms <ExternalLink /></a></Button><Button variant="ghost" className="min-h-11" onClick={() => setPicked(null)}>Back to times</Button></DrawerFooter></>}
    </DrawerContent></Drawer>
  </div>;
}
