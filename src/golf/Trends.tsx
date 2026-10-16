// Trends: scoring over time, and how far each club really goes.
import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartLine } from 'lucide-react';
import { Empty } from '@/components/page';
import { trackedShots } from '@/lib/clubs';
import { fmtToPar } from '@/lib/round';
import { rollingMedian, summarize } from '@/lib/stats';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Chart } from './Chart';

// Theme colours: green for each round or shot, tangerine for the trend through them.
const color = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const dots = (stroke: string, label: string): uPlot.Series => ({ label, stroke, width: 0, points: { show: true, size: 7, fill: stroke }, paths: () => null });
const line = (stroke: string, label: string): uPlot.Series => ({ label, stroke, width: 2.5, points: { show: false }, spanGaps: true });

function Card({ title, legend, children }: { title: string; legend?: [string, string]; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        {legend && (
          <p className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />{legend[0]}</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-orange" />{legend[1]}</span>
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

export default function Trends() {
  const rounds = useStore((s) => s.rounds);
  const bag = useStore((s) => s.bag);
  const all = useMemo(() => Object.values(rounds), [rounds]);
  const sums = useMemo(() => all.map(summarize).filter((s) => s.holes > 0).sort((a, b) => a.t - b.t), [all]);
  const shots = useMemo(() => trackedShots(all), [all]);
  const [green, orange] = useMemo(() => [color('--primary'), color('--orange')], []);

  const scoreData = useMemo<uPlot.AlignedData>(() => [sums.map((s) => s.t), sums.map((s) => s.toPar), sums.map((s) => s.differential)], [sums]);
  const scoreSeries = useMemo(() => [dots(green, 'To par'), line(orange, 'Differential')], [green, orange]);

  const tracked = bag.clubs.filter((c) => shots.some((s) => s.club === c.id));
  const [clubId, setClubId] = useState<string | null>(null);
  const club = tracked.find((c) => c.id === clubId) ?? tracked[0];
  const clubData = useMemo<uPlot.AlignedData>(() => {
    const cs = shots.filter((s) => s.club === club?.id);
    const yds = cs.map((s) => Math.round(s.yd));
    // uPlot needs strictly increasing x; nudge shots logged in the same second.
    return [cs.map((s, i) => Math.floor(s.t / 1000) + i * 1e-3), yds, rollingMedian(yds)];
  }, [shots, club?.id]);
  const clubSeries = useMemo(() => [dots(green, 'Shot'), line(orange, 'Median of last 10')], [green, orange]);

  if (!sums.length) return <Empty icon={<ChartLine />} title="No trends yet">Play a round and your scoring and club distances show up here.</Empty>;
  const last = sums.at(-1)!;

  return (
    <div className="space-y-3">
      <Card title="Scoring" legend={['To par', 'Differential']}>
        {sums.length > 1
          ? <Chart data={scoreData} series={scoreSeries} height={200} />
          : <p className="text-sm text-muted-foreground">A trend shows up after your second round.</p>}
        <p className="text-xs text-muted-foreground">Last round: {fmtToPar(last.toPar)} over {last.holes} {last.holes === 1 ? 'hole' : 'holes'}</p>
      </Card>

      <Card title="Club distances" legend={club ? ['Each shot', 'Median'] : undefined}>
        {club ? (
          <>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
              {tracked.map((c) => (
                <button key={c.id} type="button" aria-pressed={c.id === club.id} onClick={() => setClubId(c.id)}
                  className={cn('h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium', c.id === club.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background')}>
                  {c.name}
                </button>
              ))}
            </div>
            {clubData[0].length > 1
              ? <Chart data={clubData} series={clubSeries} height={200} yLabel="yards" />
              : <p className="text-sm text-muted-foreground">One {club.name} shot so far: {clubData[1][0]} y. A trend shows up after the second.</p>}
            <p className="text-xs text-muted-foreground">Your stock {club.name}: {club.stock ?? '–'} y</p>
          </>
        ) : <p className="text-sm text-muted-foreground">Mark shots during a round to see how far each club goes.</p>}
      </Card>
    </div>
  );
}
