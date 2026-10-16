// My golf: your numbers up top, then Rounds, Trends and Bag. Start a round from the button at the bottom.
// Everything here is yours alone; a game only ever sees your score.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Flag, Play as PlayIcon } from 'lucide-react';
import { Empty, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { closeSheet, go } from '@/lib/nav';
import { fmtToPar, playedHoles, toPar, totalScore } from '@/lib/round';
import { handicapIndex, summarize } from '@/lib/stats';
import { saveRound, setActive, useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Round } from '@/schemas/round';
import { BagView } from './Bag';
import { StartRound } from './StartRound';
import { SyncStatus } from '@/components/data-status';

// Charts (uPlot) load only when Trends opens.
const Trends = lazy(() => import('./Trends'));

export type GolfTab = 'rounds' | 'trends' | 'bag';

export function MyGolf({ tab, start = false }: { tab: GolfTab; start?: boolean }) {
  const rounds = useStore((s) => s.rounds);
  const active = useStore((s) => (s.activeId ? s.rounds[s.activeId] : undefined));
  const [starting, setStarting] = useState(start);
  useEffect(() => { if (start) setStarting(true); }, [start]);

  const list = useMemo(() => Object.values(rounds).sort((a, b) => b.date.localeCompare(a.date)), [rounds]);
  const sums = useMemo(() => list.map(summarize).filter((s) => s.holes > 0).sort((a, b) => a.t - b.t), [list]);
  const full = sums.filter((s) => s.holes === 18);
  const holes = sums.reduce((n, s) => n + s.holes, 0);
  const girHoles = sums.reduce((n, s) => n + s.girHoles, 0);
  const hi = handicapIndex(sums.flatMap((s) => (s.differential == null ? [] : [s.differential])));
  const recent = full.slice(-5);

  const end = () => {
    if (!active) return;
    saveRound({ ...active, done: true, updatedAt: new Date().toISOString() }, { push: true });
    setActive(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <PageHeader back={() => go('profile')} title="My golf" sub="Only you see this. Games see your score." />

        <div className="space-y-4 px-4 pt-2">
          <SyncStatus />
          {active && (
            <div className="rounded-2xl bg-orange-soft p-4">
              <p className="text-xs font-semibold tracking-wide text-orange-strong uppercase">Round in progress</p>
              <p className="mt-0.5 font-semibold">{active.courseName}</p>
              <p className="text-sm text-muted-foreground">
                {active.teeName} · {playedHoles(active).length ? `${fmtToPar(toPar(active))} thru ${playedHoles(active).length}` : 'not started'}
              </p>
              <div className="mt-3 flex gap-2">
                <Button className="h-11 flex-1 rounded-xl" onClick={() => go('golf/play')}><PlayIcon /> Resume</Button>
                <Button variant="outline" className="h-11 rounded-xl" onClick={end}>End round</Button>
              </div>
            </div>
          )}

          {sums.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Handicap" value={hi != null ? hi.toFixed(1) : '–'} />
            <Stat label="Avg score" value={recent.length ? String(Math.round(recent.reduce((s, r) => s + r.score, 0) / recent.length)) : '–'} />
            <Stat label="Putts/hole" value={holes ? (sums.reduce((n, s) => n + s.putts, 0) / holes).toFixed(1) : '–'} />
            <Stat label="Greens" value={girHoles ? `${Math.round((100 * sums.reduce((n, s) => n + s.gir, 0)) / girHoles)}%` : '–'} />
          </div>}

          <Tabs value={tab} onValueChange={(v) => location.replace(`#golf${v === 'rounds' ? '' : `/${v}`}`)}>
            <TabsList className="h-10 w-full rounded-full">
              <TabsTrigger value="rounds" className="rounded-full">Rounds</TabsTrigger>
              <TabsTrigger value="trends" className="rounded-full">Trends</TabsTrigger>
              <TabsTrigger value="bag" className="rounded-full">Bag</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'rounds' && (
            list.length === 0 ? (
              <Empty icon={<Flag />} title="No rounds yet">
                Choose a course and tees to get started. At your ball, mark each shot before you hit. Your scorecard and club distances build as you play.
              </Empty>
            ) : (
              <div className="space-y-2">{list.map((r) => <RoundRow key={r.id} r={r} />)}</div>
            )
          )}
          {tab === 'trends' && <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}><Trends /></Suspense>}
          {tab === 'bag' && <BagView />}
        </div>
      </div>

      {!active && (
        <div className="shrink-0 px-4 pt-2 pb-3">
          <Button className="h-12 w-full rounded-2xl text-base shadow-sm" onClick={() => setStarting(true)}><Flag /> Start a round</Button>
        </div>
      )}
      <StartRound historyManaged={start} open={starting} onOpenChange={(open) => { setStarting(open); if (!open && start) closeSheet('golf'); }} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card px-2 py-3 text-center">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** A round: when, where, and how it went. */
function RoundRow({ r }: { r: Round }) {
  const d = new Date(r.date);
  const played = playedHoles(r).length;
  const par = toPar(r);
  return (
    <a href={`#golf/round/${r.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-3 active:bg-accent">
      <span className="grid w-12 shrink-0 place-items-center rounded-xl bg-secondary py-1.5 leading-none text-secondary-foreground">
        <span className="text-[0.625rem] font-semibold tracking-wide uppercase">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
        <span className="mt-0.5 text-xl font-bold">{d.getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.courseName.replace(/ Golf Course$/, '')}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {r.teeName} · {r.done ? `${played} holes` : <span className="font-medium text-orange-strong">in progress · thru {played}</span>}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-xl font-bold tabular-nums">{totalScore(r) || '–'}</span>
        {played > 0 && <span className={cn('block text-xs font-semibold tabular-nums', par <= 0 ? 'text-primary' : 'text-muted-foreground')}>{fmtToPar(par)}</span>}
      </span>
    </a>
  );
}
