import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Bell, BellPlus, ChevronDown, Clock, Loader2, RefreshCw, SearchX, User, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Empty, IconAction, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AlertSetupDialog } from '@/features/alerts/AlertSetupDialog';
import { TimeSheet } from '@/features/games/TimeSheet';
import { CoursePicker } from './CoursePicker';
import { dayLabel } from '@/features/games/label';
import { api } from '@/lib/api';
import { go } from '@/lib/nav';
import { courseByCode, MAX_DAYS, NYC_COURSES, nyToday } from '@/lib/nyc';
import { filterTimes, fmtMinutes, toMinutes } from '@/lib/teetimes';
import { cn } from '@/lib/utils';
import type { Game, Member } from '@/schemas/group';
import type { Criteria, TeeTime, TeeTimesResponse } from '@/schemas/teetimes';

export type Form = { dates: string[]; golfers: number[]; codes: string[]; holes18: boolean };

type State = {
  /** The search form, as last edited. */
  form: Form;
  /** The search behind `response`; the results screen reads only this. */
  last: Form | null;
  response: TeeTimesResponse | null;
  loading: boolean;
  /** Results-screen toggles: hidden dates, courses switched on, time window. */
  hidden: string[];
  on: string[];
  window: [number, number];
};

const FORM_KEY = 'golf.teetimes.form';
const EMPTY: Form = { dates: [], golfers: [], codes: [], holes18: true };

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const strip = () => Array.from({ length: MAX_DAYS + 1 }, (_, i) => addDays(nyToday(), i));

function loadForm(): Form {
  try {
    const saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? 'null') as Partial<Form> | null;
    if (!saved) return EMPTY;
    const days = strip();
    return {
      dates: (saved.dates ?? []).filter((d) => days.includes(d)).slice(0, 3),
      golfers: (saved.golfers ?? []).filter((g) => g >= 1 && g <= 4).sort().slice(0, 1), // one choice: "at least N"
      codes: (saved.codes ?? []).filter((c) => courseByCode(c)),
      holes18: saved.holes18 ?? true,
    };
  } catch {
    return EMPTY;
  }
}

let state: State = {
  form: loadForm(),
  last: null,
  response: null,
  loading: false,
  hidden: [],
  on: [],
  window: [300, 1200],
};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const update = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const useStore = () => useSyncExternalStore(subscribe, () => state);

function setForm(patch: Partial<Form>) {
  const form = { ...state.form, ...patch };
  update({ form });
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify(form));
  } catch {
    // Private mode or blocked storage: the form still works for this visit.
  }
}

async function fetchTimes(f: Form, force = false): Promise<TeeTimesResponse> {
  const live = f.codes.filter((c) => courseByCode(c)?.tenant);
  if (!live.length) return { times: [], fetched: {}, errors: [] };
  return api<TeeTimesResponse>(`/tee-times?dates=${f.dates.join(',')}&codes=${live.join(',')}${force ? '&force=1' : ''}`);
}

async function find() {
  const f = state.form;
  // Straight to the results screen; it shows placeholder rows until times arrive.
  update({ loading: true, response: null, last: f, hidden: [], on: f.codes });
  go('results');
  try {
    update({ response: await fetchTimes(f), loading: false });
  } catch {
    update({ loading: false, last: null });
    go('');
    toast.error("Couldn't load tee times. Try again.");
  }
}

/** Search from elsewhere (a game needing another tee time): fill the form and window, then find. */
export function searchFor(form: Form, window: [number, number]) {
  setForm(form);
  update({ window });
  void find();
}

/** First search ever: start with the member's home course picked. */
let homeChecked = false;
function useHomeCourse() {
  useEffect(() => {
    if (homeChecked || state.form.codes.length) return;
    homeChecked = true;
    api<Member>('/me')
      .then((m) => { if (m.homeCourse && !state.form.codes.length) setForm({ codes: [m.homeCourse] }); })
      .catch(() => {});
  }, []);
}

async function refresh() {
  const last = state.last;
  if (!last) return;
  update({ loading: true });
  try {
    update({ response: await fetchTimes(last, true), loading: false });
  } catch {
    update({ loading: false });
    toast.error("Couldn't refresh. Try again.");
  }
}

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dom = (d: string) => Number(d.slice(8));
const short = (hhmm: string) => {
  const m = toMinutes(hhmm);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}${m < 720 ? 'a' : 'p'}`;
};
const uniq = (ts: TeeTime[]) => {
  const seen = new Set<string>();
  return ts.filter((t) => {
    const k = `${t.date}|${t.code}|${t.time}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const minutesAgo = (fetched: Record<string, string>) => {
  const oldest = Math.min(...Object.values(fetched).map((v) => Date.parse(v)));
  return Number.isFinite(oldest) ? Math.max(0, Math.floor((Date.now() - oldest) / 60_000)) : null;
};

const Heading = ({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="flex min-h-8 items-center justify-between">
    <h2 className="text-sm font-semibold">{children}</h2>
    {aside}
  </div>
);

function SearchScreen({ alerts }: { alerts: number }) {
  const { form, loading } = useStore();
  useHomeCourse();
  const days = strip();
  const allOn = form.codes.length === NYC_COURSES.length;

  const pickDate = (d: string) =>
    setForm({ dates: form.dates.includes(d) ? form.dates.filter((x) => x !== d) : [...form.dates, d].sort() });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tee times"
        actions={<IconAction label="Alerts" count={alerts} onClick={() => go('alerts')}><Bell className="size-5" /></IconAction>}
      />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-2 pb-4">
        <section className="space-y-2">
          <Heading aside={<span className="text-xs text-muted-foreground">up to 3</span>}>When</Heading>
          <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {days.map((d, i) => {
              const on = form.dates.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && form.dates.length >= 3}
                  onClick={() => pickDate(d)}
                  className={cn(
                    'flex w-14 shrink-0 snap-start flex-col items-center rounded-2xl border py-2 text-xs transition-colors active:scale-95 disabled:opacity-40',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
                  )}
                >
                  <span className={cn(!on && 'text-muted-foreground')}>{i === 0 ? 'Today' : dow(d)}</span>
                  <span className="text-lg font-semibold">{dom(d)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <Heading>Golfers</Heading>
          <ToggleGroup
            type="single"
            variant="outline"
            className="w-full"
            value={String(form.golfers[0] ?? 0)}
            onValueChange={(v) => v && setForm({ golfers: v === '0' ? [] : [Number(v)] })}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <ToggleGroupItem key={n} value={String(n)} className="h-11 flex-1 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                {n || 'Any'}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>

        <section className="space-y-2">
          <Heading
            aside={(
              <Button variant="ghost" size="sm" className="-mr-2 min-h-11 text-primary" onClick={() => setForm({ codes: allOn ? [] : NYC_COURSES.map((c) => c.code) })}>
                {allOn ? 'Clear' : 'All'}
              </Button>
            )}
          >
            Where
          </Heading>
          <CoursePicker selected={form.codes} onToggle={(code) => setForm({ codes: toggle(form.codes, code) })} />
        </section>

        <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border bg-card px-4">
          <span className="text-sm font-medium">18 holes only</span>
          <Switch checked={form.holes18} onCheckedChange={(v) => setForm({ holes18: v })} />
        </label>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3">
        <Button className="h-12 w-full rounded-2xl text-base shadow-sm" disabled={!form.dates.length || !form.codes.length || loading} onClick={find}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? 'Searching…' : !form.dates.length ? 'Pick a date' : !form.codes.length ? 'Pick a course' : 'Find tee times'}
        </Button>
      </div>
    </div>
  );
}

function Row({ t, showCode, inGame, onOpen }: { t: TeeTime; showCode: boolean; inGame: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-12 w-full items-center gap-1.5 rounded-xl border bg-card px-3 text-left text-sm transition-colors active:scale-[0.98] active:bg-accent">
      <span className="font-semibold tabular-nums">{short(t.time)}</span>
      {showCode && <span className="text-xs text-muted-foreground">{t.code}</span>}
      {inGame && <Users className="size-3.5 text-primary" aria-label="Already in a group game" />}
      <span className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums" aria-label={`${t.spots} spots`}>
        <User className="size-3" />{t.spots}
      </span>
    </button>
  );
}

function Results() {
  const { last, response, hidden, on, window: win, loading } = useStore();
  const [alertOpen, setAlertOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [picked, setPicked] = useState<TeeTime | null>(null);
  // Times the group already has in a game, so nobody proposes or books them twice.
  const [grouped, setGrouped] = useState<Set<string>>(new Set());
  useEffect(() => {
    api<Game[]>('/games')
      .then((games) => setGrouped(new Set(games.flatMap((g) => g.times.map((t) => `${g.code}|${t.teetime}`)))))
      .catch(() => {});
  }, [picked]);

  const all = useMemo(() => {
    if (!response || !last) return [];
    return uniq(filterTimes(response.times, {
      dates: last.dates,
      codes: on,
      golfers: last.golfers,
      holes18: last.holes18,
      window: win,
    }));
  }, [response, last, on, win]);

  if (loading && !response && last) {
    return (
      <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading tee times">
        <PageHeader back={() => go('')} title="Searching…" sub="Live from TeeItUp" />
        <div className="grid gap-2 px-4 pt-2" style={{ gridTemplateColumns: `repeat(${last.dates.length}, minmax(0, 1fr))` }}>
          {last.dates.map((d) => (
            <div key={d} className="space-y-1.5">
              {Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!response || !last) return null;

  const visible = last.dates.filter((d) => !hidden.includes(d));
  const shown = all.filter((t) => visible.includes(t.date));
  const canAlert = visible.length > 0 && on.length > 0;
  const criteria: Criteria = { dates: visible, golfers: last.golfers, codes: on.filter((c) => courseByCode(c)?.tenant), holes18: last.holes18, window: win };
  const failedTenants = new Set(response.errors.map((e) => e.tenant));
  const failed = last.codes.filter((c) => {
    const tenant = courseByCode(c)?.tenant;
    return !!tenant && failedTenants.has(tenant);
  });
  const mins = minutesAgo(response.fetched);
  const manyDates = last.dates.length > 1;
  const manyCourses = last.codes.length > 1;
  const title = `${last.dates.map((d) => (manyDates ? `${dow(d)} ${dom(d)}` : dayLabel(d))).join(', ')} · ${last.codes.length > 3 ? `${last.codes.length} courses` : last.codes.join(', ')}`;
  const chip = 'flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        back={() => go('')}
        title={title}
        sub={`${shown.length} ${shown.length === 1 ? 'time' : 'times'}${mins !== null ? ` · updated ${mins === 0 ? 'just now' : `${mins} min ago`}` : ''}`}
        actions={(
          <>
            <IconAction label="Alert me about new times" disabled={!canAlert} onClick={() => setAlertOpen(true)}><BellPlus className="size-5" /></IconAction>
            <IconAction label="Refresh" disabled={loading} onClick={refresh}><RefreshCw className={cn('size-5', loading && 'animate-spin')} /></IconAction>
          </>
        )}
      />

      {/* Filters: time of day, then each course on or off. */}
      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
        <button type="button" onClick={() => setTimeOpen(true)} className={cn(chip, 'border-primary bg-accent text-accent-foreground')}>
          <Clock className="size-3.5" /> {windowName(win)} <ChevronDown className="size-3.5" />
        </button>
        {manyCourses && last.codes.map((code) => {
          const isOn = on.includes(code);
          return (
            <button key={code} type="button" aria-pressed={isOn} onClick={() => update({ on: toggle(on, code) })}
              className={cn(chip, isOn ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}>
              {code}
            </button>
          );
        })}
      </div>

      {(failed.length > 0 || last.codes.includes('MOS')) && (
        <p className="mx-4 mb-3 rounded-xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
          {failed.length > 0 && `Couldn't load ${failed.join(', ')}. `}
          {last.codes.includes('MOS') && "Mosholu isn't on TeeItUp, so no live times."}
        </p>
      )}

      {manyDates && (
        <div className="grid shrink-0 gap-2 px-4 pb-2" style={{ gridTemplateColumns: `repeat(${last.dates.length}, minmax(0, 1fr))` }}>
          {last.dates.map((d) => {
            const isOn = !hidden.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isOn}
                onClick={() => update({ hidden: isOn ? [...hidden, d] : hidden.filter((x) => x !== d) })}
                className={cn('min-h-9 rounded-full px-1 text-xs font-semibold', isOn ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}
              >
                {dow(d)} {dom(d)} <span className="font-normal opacity-70">· {all.filter((t) => t.date === d).length}</span>
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty icon={<SearchX />} title="No tee times match" action={<Button variant="outline" className="min-h-11 rounded-full" onClick={() => setTimeOpen(true)}>Change time of day</Button>}>
          Try a wider time, more courses, or set an alert for when one opens.
        </Empty>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2 px-4 pb-3"
          style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`, gridTemplateRows: 'minmax(0, 1fr)' }}
        >
          {visible.map((d) => (
            <div key={d} className="min-h-0 space-y-1.5 overflow-y-auto">
              {shown.filter((t) => t.date === d).map((t) => (
                <Row key={`${t.code}|${t.time}`} t={t} showCode={manyCourses} inGame={grouped.has(`${t.code}|${t.teetime}`)} onOpen={() => setPicked(t)} />
              ))}
            </div>
          ))}
        </div>
      )}

      <TimeOfDay open={timeOpen} onOpenChange={setTimeOpen} value={win} onChange={(w) => update({ window: w })} count={(w) => all.filter((t) => visible.includes(t.date) && toMinutes(t.time) >= w[0] && toMinutes(t.time) <= w[1]).length} />
      <TimeSheet time={picked} onClose={() => setPicked(null)} />
      <AlertSetupDialog open={alertOpen} onOpenChange={setAlertOpen} mode="create" criteria={criteria} visible={shown} />
    </div>
  );
}

const PRESETS: { label: string; window: [number, number] }[] = [
  { label: 'Any time', window: [300, 1200] },
  { label: 'Early, before 9am', window: [300, 540] },
  { label: 'Morning, before noon', window: [300, 720] },
  { label: 'Afternoon, noon on', window: [720, 1200] },
  { label: 'Twilight, 3pm on', window: [900, 1200] },
];
const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
/** The chip's label: a preset's short name ("Morning"), or the exact window. */
const windowName = (w: [number, number]) =>
  PRESETS.find((p) => same(p.window, w))?.label.split(',')[0] ?? `${fmtMinutes(w[0])}–${fmtMinutes(w[1])}`;

/** Time of day: a few common picks, or drag for an exact window. Results update as you go. */
function TimeOfDay({ open, onOpenChange, value, onChange, count }: {
  open: boolean; onOpenChange: (o: boolean) => void; value: [number, number];
  onChange: (w: [number, number]) => void; count: (w: [number, number]) => number;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Time of day</DrawerTitle>
          <DrawerDescription>{fmtMinutes(value[0])} to {fmtMinutes(value[1])} · {count(value)} times</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-5 px-5 pt-2">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" aria-pressed={same(p.window, value)} onClick={() => onChange(p.window)}
                className={cn('min-h-10 rounded-full border px-3.5 text-sm', same(p.window, value) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <Slider min={300} max={1200} step={15} minStepsBetweenThumbs={0} value={value} onValueChange={([a, b]) => onChange([a, b])} aria-label="Time window" />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{fmtMinutes(300)}</span>
              <span>{fmtMinutes(1200)}</span>
            </div>
          </div>
        </div>
        <DrawerFooter>
          <Button className="h-12 rounded-2xl text-base" onClick={() => onOpenChange(false)}>Show {count(value)} times</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export function TeeTimes({ view, alerts }: { view: 'search' | 'results'; alerts: number }) {
  // Results live in memory; after a reload (say the phone closed the app while you were on TeeItUp) start from the form.
  const { last } = useStore();
  return view === 'results' && last ? <Results /> : <SearchScreen alerts={alerts} />;
}
