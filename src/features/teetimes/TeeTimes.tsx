import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BellPlus, ChevronLeft, Loader2, RefreshCw, User, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
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
  window: [360, 1200],
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

function SearchScreen() {
  const { form, loading } = useStore();
  useHomeCourse();
  const days = strip();
  const allOn = form.codes.length === NYC_COURSES.length;

  const pickDate = (d: string) =>
    setForm({ dates: form.dates.includes(d) ? form.dates.filter((x) => x !== d) : [...form.dates, d].sort() });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-5 pb-4">
        <section className="space-y-2">
          <Heading aside={<span className="text-xs text-muted-foreground">up to 3</span>}>Dates</Heading>
          <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1">
            {days.map((d) => {
              const on = form.dates.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && form.dates.length >= 3}
                  onClick={() => pickDate(d)}
                  className={cn(
                    'flex w-14 shrink-0 snap-start flex-col items-center rounded-xl border py-2 text-xs disabled:opacity-40',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
                  )}
                >
                  <span>{dow(d)}</span>
                  <span className="text-lg font-semibold">{dom(d)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <Heading>Golfers</Heading>
          <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Golfers">
            {[0, 1, 2, 3, 4].map((n) => {
              const on = n === 0 ? !form.golfers.length : form.golfers[0] === n;
              return (
                <Button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  variant={on ? 'default' : 'outline'}
                  className="h-11"
                  onClick={() => setForm({ golfers: n ? [n] : [] })}
                >
                  {n || 'Any'}
                </Button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <Heading
            aside={(
              <Button variant="ghost" size="sm" className="min-h-11 text-primary" onClick={() => setForm({ codes: allOn ? [] : NYC_COURSES.map((c) => c.code) })}>
                {allOn ? 'Clear' : 'All'}
              </Button>
            )}
          >
            Courses
          </Heading>
          <CoursePicker selected={form.codes} onToggle={(code) => setForm({ codes: toggle(form.codes, code) })} />
        </section>

        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-semibold">18 holes only</span>
          <Switch checked={form.holes18} onCheckedChange={(v) => setForm({ holes18: v })} />
        </label>
      </div>

      <div className="shrink-0 border-t bg-background px-4 py-3">
        <Button className="h-12 w-full text-base" disabled={!form.dates.length || !form.codes.length || loading} onClick={find}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? 'Searching…' : !form.dates.length ? 'Pick a date' : !form.codes.length ? 'Pick a course' : 'Find tee times'}
        </Button>
      </div>
    </div>
  );
}

function Row({ t, showCode, inGame, onOpen }: { t: TeeTime; showCode: boolean; inGame: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-11 w-full items-center gap-1.5 rounded-xl border bg-card px-3 text-left text-sm active:bg-accent">
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
      <div className="space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading tee times">
        <div className="h-11 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${last.dates.length}, minmax(0, 1fr))` }}>
          {last.dates.map((d) => (
            <div key={d} className="space-y-1.5">
              {Array.from({ length: 9 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-xl bg-muted" />)}
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

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 px-2 pt-2 pb-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11" aria-label="Edit search" onClick={() => go('')}><ChevronLeft /></Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">
              {shown.length} {shown.length === 1 ? 'time' : 'times'}{mins !== null && ` · updated ${mins === 0 ? 'just now' : `${mins} min ago`}`}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Set alert" disabled={!canAlert} onClick={() => setAlertOpen(true)}><BellPlus /></Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Refresh" disabled={loading} onClick={refresh}>
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="space-y-3 px-2">
          {(failed.length > 0 || last.codes.includes('MOS')) && (
            <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
              {failed.length > 0 && `Couldn't load ${failed.join(', ')}. `}
              {last.codes.includes('MOS') && "Mosholu isn't on TeeItUp, so no live times."}
            </p>
          )}

          {manyDates && (
            <div className="flex gap-2">
              {last.dates.map((d) => {
                const isOn = !hidden.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={isOn}
                    onClick={() => update({ hidden: isOn ? [...hidden, d] : hidden.filter((x) => x !== d) })}
                    className={cn('min-h-11 flex-1 rounded-xl border px-1 text-xs font-semibold', isOn ? 'border-primary bg-card' : 'bg-muted text-muted-foreground opacity-60')}
                  >
                    {dow(d)} {dom(d)} <span className="font-normal text-muted-foreground">· {all.filter((t) => t.date === d).length}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            <Slider min={300} max={1200} step={15} minStepsBetweenThumbs={0} value={win} onValueChange={([a, b]) => update({ window: [a, b] })} aria-label="Time window" />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>{fmtMinutes(win[0])}</span>
              <span>{fmtMinutes(win[1])}</span>
            </div>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tee times match. Widen the window or add courses.</p>
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

      {manyCourses && (
        <div className="flex shrink-0 flex-wrap justify-center gap-2 border-t bg-card px-4 py-3">
          {last.codes.map((code) => {
            const isOn = on.includes(code);
            return (
              <Button key={code} variant={isOn ? 'default' : 'outline'} aria-pressed={isOn} className="h-11 min-w-14" onClick={() => update({ on: toggle(on, code) })}>
                {code}
              </Button>
            );
          })}
        </div>
      )}

      <TimeSheet time={picked} onClose={() => setPicked(null)} />
      <AlertSetupDialog open={alertOpen} onOpenChange={setAlertOpen} mode="create" criteria={criteria} visible={shown} />
    </div>
  );
}

export function TeeTimes({ view }: { view: 'search' | 'results' }) {
  // Results live in memory; after a reload (say the phone closed the app while you were on TeeItUp) start from the form.
  const { last } = useStore();
  return view === 'results' && last ? <Results /> : <SearchScreen />;
}
