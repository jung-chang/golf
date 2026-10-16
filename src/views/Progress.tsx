import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { trackedShots } from '../lib/clubs';
import { fmtToPar } from '../lib/round';
import { handicapIndex, rollingMedian, summarize } from '../lib/stats';
import { useStore } from '../lib/store';
import { Chart } from './Chart';

const ACCENT = '#2f9e5b';
const SECOND = '#d9822b';
const dots = (stroke: string, label: string): uPlot.Series => ({ label, stroke, width: 0, points: { show: true, size: 7, fill: stroke }, paths: () => null });
const line = (stroke: string, label: string): uPlot.Series => ({ label, stroke, width: 2, points: { show: false }, spanGaps: true });

export function Progress() {
  const rounds = useStore((s) => s.rounds);
  const bag = useStore((s) => s.bag);
  const all = useMemo(() => Object.values(rounds), [rounds]);
  const sums = useMemo(() => all.map(summarize).filter((s) => s.holes > 0).sort((a, b) => a.t - b.t), [all]);
  const shots = useMemo(() => trackedShots(all), [all]);

  const full = sums.filter((s) => s.holes === 18);
  const diffs = sums.flatMap((s) => (s.differential == null ? [] : [s.differential]));
  const holes = sums.reduce((n, s) => n + s.holes, 0);
  const girHoles = sums.reduce((n, s) => n + s.girHoles, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const hi = handicapIndex(diffs);

  const scoreData = useMemo<uPlot.AlignedData>(() => [
    sums.map((s) => s.t),
    sums.map((s) => s.toPar),
    sums.map((s) => s.differential),
  ], [sums]);
  const scoreSeries = useMemo(() => [dots(ACCENT, 'To par'), line(SECOND, 'Differential')], []);

  const tracked = bag.clubs.filter((c) => shots.some((s) => s.club === c.id));
  const [clubId, setClubId] = useState<string | null>(null);
  const club = tracked.find((c) => c.id === clubId) ?? tracked[0];
  const clubData = useMemo<uPlot.AlignedData>(() => {
    const cs = shots.filter((s) => s.club === club?.id);
    const yds = cs.map((s) => Math.round(s.yd));
    // uPlot needs strictly increasing x; nudge shots logged in the same second.
    const xs = cs.map((s, i) => Math.floor(s.t / 1000) + i * 1e-3);
    return [xs, yds, rollingMedian(yds)];
  }, [shots, club?.id]);
  const clubSeries = useMemo(() => [dots(ACCENT, 'Shot'), line(SECOND, 'Median (last 10)')], []);

  if (!sums.length) return <div className="page"><h2>Progress</h2><p className="muted">Play a round and your trends show up here.</p></div>;

  const tile = (label: string, value: string | number | null, sub?: string) => (
    <div className="tile"><small>{label}</small><strong>{value ?? '–'}</strong>{sub && <small>{sub}</small>}</div>
  );

  return (
    <div className="page">
      <h2>Progress</h2>
      <div className="tiles">
        {tile('Handicap est.', hi, diffs.length < 3 ? `${diffs.length}/3 rounds` : `${Math.min(diffs.length, 20)} rounds`)}
        {tile('Avg score', full.length ? Math.round(avg(full.map((s) => s.score))!) : null, `${full.length} × 18 holes`)}
        {tile('Putts / hole', holes ? (sums.reduce((n, s) => n + s.putts, 0) / holes).toFixed(2) : null)}
        {tile('GIR', girHoles ? `${Math.round((100 * sums.reduce((n, s) => n + s.gir, 0)) / girHoles)}%` : null)}
      </div>

      <h3>Scoring</h3>
      <p className="muted"><span className="key" style={{ background: ACCENT }} />Score to par · <span className="key" style={{ background: SECOND }} />Differential (18 holes)</p>
      {sums.length > 1 ? <Chart data={scoreData} series={scoreSeries} /> : <p className="muted">A trend shows up after your second round.</p>}
      <p className="muted">Last: {fmtToPar(sums.at(-1)!.toPar)} over {sums.at(-1)!.holes} hole{sums.at(-1)!.holes === 1 ? '' : 's'}</p>

      <h3>Club distances</h3>
      {club ? (
        <>
          <div className="clubs">
            {tracked.map((c) => (
              <button key={c.id} className={`chip${c.id === club.id ? ' on' : ''}`} onClick={() => setClubId(c.id)}>{c.name}</button>
            ))}
          </div>
          <p className="muted"><span className="key" style={{ background: ACCENT }} />Each shot · <span className="key" style={{ background: SECOND }} />Median of last 10 · stock {club.stock ?? '–'}</p>
          {clubData[0].length > 1
            ? <Chart data={clubData} series={clubSeries} yLabel="yards" />
            : <p className="muted">One {club.name} shot so far: {clubData[1][0]} y. A trend shows up after the second.</p>}
        </>
      ) : <p className="muted">Mark shots during a round to see club distances.</p>}
    </div>
  );
}
