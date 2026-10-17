import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellPlus, Loader2, RefreshCw, Users } from 'lucide-react';
import { IconAction, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertSetupDialog } from '@/features/alerts/AlertSetupDialog';
import { TimeSheet } from '@/features/games/TimeSheet';
import { CoursePicker } from './CoursePicker';
import { dayLabel } from '@/features/games/label';
import { api } from '@/lib/api';
import { go, useOnResume } from '@/lib/nav';
import { courseByCode } from '@/lib/nyc';
import { filterTimes, fmtMinutes, toMinutes } from '@/lib/teetimes';
import { cn } from '@/lib/utils';
import { LoadError } from '@/components/data-status';
import { Criteria as CriteriaSchema, TeeTimesResponse as ResponseSchema } from '@/schemas/teetimes';
import type { Game, Member } from '@/schemas/group';
import type { Criteria, TeeTime, TeeTimesResponse } from '@/schemas/teetimes';

import { SearchParameters } from './SearchParameters';
import { dateOptions, FULL_DAY, needsSearch, restoreForm, type Form } from './search-form';
export type { Form } from './search-form';

type State = {
  /** The search form, as last edited. */
  form: Form;
  /** The search behind `response`; the results screen reads only this. */
  last: Form | null;
  response: TeeTimesResponse | null;
  loading: boolean;
  /** Results-screen toggles: hidden dates, courses switched on, time window. */
  visibleDates: string[];
  error: string | null;
  on: string[];
  window: [number, number];
};

const FORM_KEY = 'golf.teetimes.form';
const RESULTS_KEY = 'golf.teetimes.results';
const strip = dateOptions;
function loadForm(): Form {
  try { return restoreForm(JSON.parse(localStorage.getItem(FORM_KEY) ?? 'null')); }
  catch { return restoreForm(null); }
}
const initialForm = loadForm();

let state: State = {
  form: initialForm,
  last: null,
  response: null,
  loading: false,
  visibleDates: [],
  error: null,
  on: [],
  window: initialForm.window,
};
try {
  const saved = JSON.parse(sessionStorage.getItem(RESULTS_KEY) ?? 'null');
  const last = CriteriaSchema.safeParse(saved?.last);
  const response = ResponseSchema.safeParse(saved?.response);
  if (last.success && response.success && last.data.dates.every((d) => strip().includes(d)) && last.data.window[0] >= FULL_DAY[0] && last.data.window[1] <= FULL_DAY[1] && last.data.window[0] < last.data.window[1]) {
    state = { ...state, last: last.data, response: response.data,
      on: Array.isArray(saved.on) ? saved.on.filter((c: unknown) => typeof c === 'string' && last.data.codes.includes(c)) : last.data.codes,
      visibleDates: Array.isArray(saved.visibleDates) ? [...new Set<string>(saved.visibleDates.filter((d: unknown): d is string => typeof d === 'string' && last.data.dates.includes(d)))].slice(0, 2) : last.data.dates.slice(0, 2), window: last.data.window };
  }
} catch { /* expired or unavailable session storage: use the form */ }
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const update = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  try {
    if (state.last && state.response) sessionStorage.setItem(RESULTS_KEY, JSON.stringify({
      last: { ...state.last, window: state.window }, response: state.response, on: state.on, visibleDates: state.visibleDates,
    }));
    else if ('last' in patch) sessionStorage.removeItem(RESULTS_KEY);
  } catch { /* results still remain in memory */ }
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
  const parsed = CriteriaSchema.safeParse(state.form);
  if (!parsed.success || state.loading) return;
  const f = state.form;
  // Straight to the results screen; it shows placeholder rows until times arrive.
  update({ loading: true, response: null, last: f, visibleDates: f.dates.slice(0, 2), on: f.codes, window: f.window, error: null });
  go('results');
  try {
    const response = await fetchTimes(f);
    if (state.last === f) update({ response, loading: false });
  } catch {
    if (state.last === f) update({ loading: false, error: "Couldn't load tee times. Check your connection and try again." });
  }
}

/** Search from elsewhere (a game needing another tee time): fill the form and window, then find. */
export function searchFor(form: Omit<Form, 'window'>, window: [number, number]) {
  setForm({ ...form, holes: form.holes ?? (form.holes18 ? 18 : 9), window });
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
  if (!last || state.loading) return;
  update({ loading: true, error: null });
  try {
    const response = await fetchTimes(last, true);
    if (state.last === last) update({ response, loading: false });
  } catch {
    if (state.last === last) update({ loading: false, error: "Couldn't refresh. Previously loaded times are shown; availability may have changed." });
  }
}

const dow = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dom = (d: string) => Number(d.slice(8));
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

function SearchScreen({ alerts }: { alerts: number }) {
  const { form, loading } = useStore();
  useHomeCourse();
  return <div className="flex h-full flex-col">
    <PageHeader title="Tee times" actions={<IconAction label="Alerts" count={alerts} onClick={() => go('alerts')}><Bell className="size-5" /></IconAction>} />
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-2 pb-4">
      <SearchParameters form={form} onChange={setForm} />
      <CoursePicker selected={form.codes} onChange={(codes) => setForm({ codes })} />
      <Button className="min-h-12 w-full rounded-2xl text-base" disabled={!form.dates.length || !form.codes.length || loading} onClick={() => void find()}>
        {loading && <Loader2 className="animate-spin" />}
        {loading ? 'Searching…' : !form.dates.length ? 'Pick a date' : !form.codes.length ? 'Pick a course' : 'Find tee times'}
      </Button>
    </div>
  </div>;
}

function Row({ t, inGame, onOpen }: { t: TeeTime; inGame: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`${fmtMinutes(toMinutes(t.time))}, ${courseByCode(t.code)?.name ?? t.code}, ${dayLabel(t.date)}, ${t.spots} spots, ${t.holes.join(' or ')} holes${t.priceCents != null ? `, from $${(t.priceCents / 100).toFixed(2)}` : ''}${inGame ? ', already proposed' : ''}`}
      className="grid min-h-[68px] w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-1 gap-y-0.5 rounded-xl border bg-card px-2.5 py-2 text-left transition-colors active:bg-accent">
      <span className="text-sm leading-4 font-bold tabular-nums">{fmtMinutes(toMinutes(t.time))}</span>
      <span className="rounded-md bg-accent px-1.5 text-[11px] leading-4 font-semibold text-accent-foreground">{t.spots} {t.spots === 1 ? 'spot' : 'spots'}</span>
      <span className="col-span-2 truncate text-[13px] leading-4 font-semibold">{courseByCode(t.code)?.name ?? t.code}</span>
      <span className="col-span-2 text-[11px] leading-4 text-muted-foreground">{t.holes.join('/')} holes{t.priceCents != null && ` · from $${Number((t.priceCents / 100).toFixed(2))}`}</span>
      {inGame && <span className="col-span-2 flex items-center gap-1 text-[11px] font-medium text-primary"><Users className="size-3" />Proposed</span>}
    </button>
  );
}

function Results() {
  const { form, last, response, visibleDates, on, window: win, loading, error } = useStore();
  const [alertOpen, setAlertOpen] = useState(false);
  const [picked, setPicked] = useState<TeeTime | null>(null);
  const [grouped, setGrouped] = useState<Set<string>>(new Set());
  const [replaceColumn, setReplaceColumn] = useState(1);
  const resultsScroll = useRef<HTMLDivElement>(null);
  useOnResume(refresh);
  useEffect(() => {
    if (state.response && (minutesAgo(state.response.fetched) ?? 0) >= 2) void refresh();
  }, []);
  useEffect(() => {
    let alive = true;
    api<Game[]>('/games').then((games) => { if (alive) setGrouped(new Set(games.flatMap((g) => g.times.map((t) => `${g.code}|${t.teetime}`)))); }).catch(() => {});
    return () => { alive = false; };
  }, [picked]);
  const all = useMemo(() => !response || !last ? [] : uniq(filterTimes(response.times, {
    dates: last.dates, codes: on, golfers: last.golfers, holes18: last.holes18, holes: last.holes, window: win,
  })), [response, last, on, win]);
  if (!last) return null;
  const savedDates = visibleDates.filter(d => last.dates.includes(d)).slice(0, 2);
  const dates = savedDates.length ? savedDates : last.dates.slice(0, 2);
  const shown = all.filter(t => dates.includes(t.date));
  const canAlert = dates.length > 0 && on.some((c) => courseByCode(c)?.tenant);
  const criteria: Criteria = { dates: last.dates, golfers: last.golfers, codes: on.filter((c) => courseByCode(c)?.tenant), holes18: last.holes18, holes: last.holes, window: win };
  const failedTenants = new Set(response?.errors.map((e) => e.tenant));
  const failed = last.codes.filter((c) => { const tenant = courseByCode(c)?.tenant; return tenant && failedTenants.has(tenant); });
  const mins = response ? minutesAgo(response.fetched) : null;
  const changeWindow = (window: [number, number]) => { setForm({ window }); update({ window }); };
  const reset = () => { changeWindow([...FULL_DAY]); update({ on: last.codes, visibleDates: last.dates.slice(0, 2) }); };
  const setColumn = (index: number, date: string) => {
    const next = [...dates];
    const other = next.indexOf(date);
    if (other !== -1 && other !== index) next[other] = next[index];
    next[index] = date;
    update({ visibleDates: next });
    setReplaceColumn(index);
    if (resultsScroll.current) resultsScroll.current.scrollTop = 0;
  };
  return (
    <div className="flex h-full flex-col">
      <PageHeader back={() => go('')} title="Tee times"
        sub={loading ? 'Checking availability…' : `${all.length} times across ${last.dates.length} ${last.dates.length === 1 ? 'day' : 'days'}${mins !== null ? ` · checked ${mins === 0 ? 'just now' : `${mins} min ago`}` : ''}`}
        actions={<><IconAction label="Alert me about new times" disabled={!canAlert || !response} onClick={() => setAlertOpen(true)}><BellPlus className="size-5" /></IconAction><IconAction label="Refresh" disabled={loading} onClick={refresh}><RefreshCw className={cn('size-5', loading && 'animate-spin')} /></IconAction></>} />
      <div ref={resultsScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        <SearchParameters form={{ ...form, codes: last.codes, window: win }} courses={on} onChange={setForm} onWindow={changeWindow} pending={needsSearch(form, last)} loading={loading} onSearch={() => { setForm({ codes: last.codes }); void find(); }} />
      {last.dates.length > 1 && <div className="flex shrink-0 items-stretch gap-1.5 px-3 pb-2" aria-label="Day availability overview">
        {last.dates.map(d => {
          const times = all.filter(t => t.date === d);
          const inColumn = dates.indexOf(d);
          return <button key={d} type="button" aria-pressed={inColumn >= 0} aria-label={`${dayLabel(d)}, ${times.length} tee times`} onClick={() => inColumn >= 0 ? setReplaceColumn(inColumn) : setColumn(Math.min(replaceColumn, dates.length - 1), d)}
            className={cn('min-h-11 min-w-0 flex-1 rounded-xl border border-input px-1.5 py-2 text-center', inColumn >= 0 ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
            <span className="block text-xs font-semibold">{dow(d)} {dom(d)}</span>
            <span className="block text-sm leading-tight font-medium tabular-nums">{loading && !response ? '–' : times.length}</span>
          </button>;
        })}
      </div>}
      {last.dates.length > 2 && <p className="shrink-0 px-3 pb-1 text-[11px] text-muted-foreground">Tap another day to replace the {replaceColumn === 0 ? 'left' : 'right'} column, then tap a day to compare.</p>}

        <p role="status" aria-label="Compared days" className="px-1 text-[11px] text-muted-foreground">{dates.map(d => dow(d) + ' ' + dom(d)).join(' + ')} · {shown.length} shown</p>
        {error && <LoadError message={error} retry={() => void refresh()} />}
        {failed.length > 0 && <div role="alert" className="rounded-xl bg-orange-soft p-3 text-sm text-orange-strong">Some courses couldn't load: {failed.map((c) => courseByCode(c)?.name ?? c).join(', ')}. Other results are shown.<Button variant="ghost" className="min-h-11 text-inherit" disabled={loading} onClick={refresh}>Retry missing courses</Button></div>}
        {loading && !response ? <div aria-busy="true" aria-label="Loading tee times" className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div> : response && <>
          {!dates.length ? <p className="rounded-xl border p-4 text-center text-sm text-muted-foreground">Turn on a date above to show its tee times.</p> : <div className={cn('grid items-start gap-2', dates.length === 2 ? 'grid-cols-2' : 'grid-cols-1')} aria-label="Tee time date columns">
            {dates.map((date, index) => {
              const times = all.filter(t => t.date === date);
              return <section key={date} aria-label={`${dayLabel(date)} tee times`} className="min-w-0 space-y-1.5">
                <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-1 bg-background text-xs">
                  <h2 className="font-semibold"><button type="button" className="min-h-11" aria-label={(index === 0 ? 'Left' : 'Right') + ' comparison column'} onClick={() => setReplaceColumn(index)}>{dow(date)} {dom(date)}</button></h2>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{times.length} {times.length === 1 ? 'time' : 'times'}</span>
                </div>
                {times.length ? times.map(t => <Row key={`${t.code}|${t.teetime}`} t={t} inGame={grouped.has(`${t.code}|${t.teetime}`)} onOpen={() => setPicked(last.holes ? { ...t, holes: [last.holes] } : t)} />) : <p className="rounded-xl border bg-card p-3 text-xs text-muted-foreground">No matching times. Widen the time range or change courses.</p>}
              </section>;
            })}
          </div>}
          {!shown.length && dates.length > 0 && <Button variant="outline" className="min-h-11 w-full" onClick={reset}>Reset filters</Button>}
          <p className="pt-2 text-[11px] text-muted-foreground">Availability can change. Proposing a time does not reserve it.</p>
        </>}
      </div>
      <TimeSheet time={picked} onClose={() => setPicked(null)} />
      <AlertSetupDialog open={alertOpen} onOpenChange={setAlertOpen} mode="create" criteria={criteria} visible={all} />
    </div>
  );
}
export function TeeTimes({ view, alerts }: { view: 'search' | 'results'; alerts: number }) {
  // Restore this tab's search after returning from booking or reloading the app.
  const { last } = useStore();
  return view === 'results' && last ? <Results /> : <SearchScreen alerts={alerts} />;
}
