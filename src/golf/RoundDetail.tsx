// One round: the scorecard, then every shot hole by hole.
import { lazy, Suspense, useState } from 'react';
import { Flag, Trash2 } from 'lucide-react';
import { Empty, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { shotYards } from '@/lib/clubs';
import { go } from '@/lib/nav';
import { fmtToPar, holeScore, playedHoles, toPar, totalScore } from '@/lib/round';
import { deleteRound, setActive, useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Round } from '@/schemas/round';
import { getCourse } from '@/lib/courses';

const HoleReview = lazy(() => import('../play/HoleReview').then(m => ({ default: m.HoleReview })));

/** Score cell: under par in green, bogey in sand, double or worse in tangerine. */
function scoreClass(score: number, par: number) {
  if (!score) return '';
  const d = score - par;
  return d < 0 ? 'bg-primary text-primary-foreground rounded-full' : d === 1 ? 'bg-secondary rounded-md' : d > 1 ? 'bg-orange-soft text-orange-strong rounded-md' : '';
}

function Nine({ r, nums, label }: { r: Round; nums: number[]; label: string }) {
  const sum = (f: (n: number) => number) => nums.reduce((s, n) => s + f(n), 0);
  const cell = 'w-7 py-1.5 text-center';
  return (
    <table className="w-full text-sm tabular-nums">
      <tbody>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1.5 pr-2 text-left font-medium">Hole</th>{nums.map((n) => <th key={n} className={cn(cell, 'font-medium')}>{n}</th>)}<th className="pl-1 text-right font-semibold">{label}</th>
        </tr>
        <tr className="text-muted-foreground">
          <td className="pr-2">Par</td>{nums.map((n) => <td key={n} className={cell}>{r.pars[n]}</td>)}<td className="pl-1 text-right">{sum((n) => r.pars[n] ?? 0)}</td>
        </tr>
        <tr className="font-semibold">
          <td className="pr-2">Score</td>
          {nums.map((n) => {
            const s = holeScore(r.holes[n]);
            return <td key={n} className={cell}><span className={cn('mx-auto grid size-6 place-content-center', scoreClass(s, r.pars[n] ?? 0))}>{s || ''}</span></td>;
          })}
          <td className="pl-1 text-right">{sum((n) => holeScore(r.holes[n])) || ''}</td>
        </tr>
        <tr className="text-muted-foreground">
          <td className="pr-2">Putts</td>{nums.map((n) => <td key={n} className={cell}>{r.holes[n]?.putts || ''}</td>)}<td className="pl-1 text-right">{sum((n) => r.holes[n]?.putts ?? 0) || ''}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function RoundDetail({ id }: { id: string }) {
  const r = useStore((s) => s.rounds[id]);
  const bag = useStore((s) => s.bag);
  const [confirming, setConfirming] = useState(false);
  const [reviewHole, setReviewHole] = useState<number | null>(null);
  if (!r) return <><PageHeader back={() => go('golf')} title="Round" /><Empty icon={<Flag />} title="Round not found" /></>;

  const nums = Object.keys(r.pars).map(Number).sort((a, b) => a - b);
  const course = getCourse(r.courseId);
  const reviewed = course?.holes.find(h => h.number === reviewHole);
  const name = (club: string) => bag.clubs.find((c) => c.id === club)?.name ?? club;
  const played = playedHoles(r).length;
  const putts = nums.reduce((s, n) => s + (r.holes[n]?.putts ?? 0), 0);
  const date = new Date(r.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="pb-8">
      <PageHeader back={() => go('golf')} title={r.courseName.replace(/ Golf Course$/, '')} sub={`${date} · ${r.teeName}`} />
      <div className="space-y-5 px-4 pt-2">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border bg-card py-3"><p className="text-2xl font-bold tabular-nums">{totalScore(r) || '–'}</p><p className="text-xs text-muted-foreground">Score</p></div>
          <div className="rounded-2xl border bg-card py-3"><p className="text-2xl font-bold tabular-nums">{played ? fmtToPar(toPar(r)) : '–'}</p><p className="text-xs text-muted-foreground">To par · {played} {played === 1 ? 'hole' : 'holes'}</p></div>
          <div className="rounded-2xl border bg-card py-3"><p className="text-2xl font-bold tabular-nums">{putts || '–'}</p><p className="text-xs text-muted-foreground">Putts</p></div>
        </div>

        <section className="space-y-3 overflow-x-auto rounded-2xl border bg-card p-3">
          <Nine r={r} nums={nums.slice(0, 9)} label="Out" />
          {nums.length > 9 && <Nine r={r} nums={nums.slice(9)} label="In" />}
        </section>

        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Shots</h2>
          <div className="divide-y rounded-2xl border bg-card">
            {nums.filter((n) => holeScore(r.holes[n]) > 0).map((n) => {
              const h = r.holes[n];
              return (
                <div key={n} className="flex flex-wrap gap-3 px-4 py-2.5 text-sm">
                  <span className="w-6 shrink-0 font-semibold tabular-nums">{n}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {h.shots.map((s, i) => (
                      <span key={i} className={cn('rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground', s.mishit && 'line-through opacity-60')}>
                        {name(s.club)}{s.end ? ` ${Math.round(shotYards(s)!)}` : ''}
                      </span>
                    ))}
                    {h.putts > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">{h.putts} {h.putts === 1 ? 'putt' : 'putts'}</span>}
                    {h.penalties > 0 && <span className="rounded-full bg-orange-soft px-2 py-0.5 text-xs text-orange-strong">{h.penalties} pen</span>}
                  </span>
                  {course?.holes.some(hole => hole.number === n) && <Button variant="ghost" className="min-h-11 w-full justify-start rounded-xl" onClick={() => setReviewHole(n)}>Review hole {n} · map & shots</Button>}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex gap-2">
          {!r.done && <Button className="h-12 flex-1 rounded-2xl text-base" onClick={() => { setActive(r.id); go('golf/play'); }}><Flag /> Continue round</Button>}
          <Button
            variant={confirming ? 'destructive' : 'ghost'}
            className={cn('h-12 rounded-2xl', !confirming && 'text-flag', r.done && 'flex-1')}
            onClick={() => { if (!confirming) return setConfirming(true); deleteRound(r.id); go('golf'); }}
            onBlur={() => setConfirming(false)}
          >
            <Trash2 /> {confirming ? 'Tap again to delete' : 'Delete round'}
          </Button>
        </div>
      </div>
      {reviewed && <Suspense fallback={<p role="status" className="fixed inset-x-4 bottom-4 z-50 rounded-xl bg-card p-4 shadow-md">Loading hole review…</p>}>
        <HoleReview key={reviewed.number} hole={reviewed} state={r.holes[reviewed.number]} bag={bag} onClose={() => setReviewHole(null)} />
      </Suspense>}
    </div>
  );
}
