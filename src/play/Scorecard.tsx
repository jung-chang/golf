// The round on one card: par and your score per hole, marked the way a paper card is
// (circle under par, square over), with Out/In/Total. Tap a hole to go to it.
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { fmtToPar, holeScore } from '@/lib/round';
import { cn } from '@/lib/utils';
import type { Course } from '@/schemas/course';
import type { Round } from '@/schemas/round';

// A hole counts once it's finished, or once you've moved on from it.
const counted = (round: Round, n: number) => {
  const h = round.holes[n];
  return h && holeScore(h) > 0 && (h.completed || n !== round.current) ? holeScore(h) : null;
};

export function Scorecard({ course, round, open, onOpenChange, onPick }: {
  course: Course; round: Round; open: boolean; onOpenChange: (o: boolean) => void; onPick: (hole: number) => void;
}) {
  const nines = [course.holes.slice(0, 9), course.holes.slice(9)].filter((n) => n.length);
  const sum = (holes: Course['holes']) => {
    const played = holes.filter((h) => counted(round, h.number) != null);
    return { par: holes.reduce((s, h) => s + h.par, 0), score: played.reduce((s, h) => s + counted(round, h.number)!, 0),
      toPar: played.reduce((s, h) => s + counted(round, h.number)! - h.par, 0), n: played.length };
  };
  const total = sum(course.holes);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Scorecard</DrawerTitle>
          <DrawerDescription>{total.n ? `${total.score} (${fmtToPar(total.toPar)}) thru ${total.n}` : 'No holes finished yet'} · {round.teeName} tees</DrawerDescription>
        </DrawerHeader>
        <div className="space-y-3 overflow-x-auto px-4 pb-6">
          {nines.map((holes, i) => {
            const s = sum(holes);
            return (
              <table key={i} className="w-full table-fixed text-center text-sm tabular-nums" aria-label={i ? 'Back nine' : 'Front nine'}>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="w-10 text-left font-medium">Hole</th>
                    {holes.map((h) => <th key={h.number} className={cn('font-medium', h.number === round.current && 'text-foreground')}>{h.number}</th>)}
                    <th className="w-9 font-medium">{i ? 'In' : 'Out'}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-medium">Par</th>
                    {holes.map((h) => <td key={h.number}>{h.par}</td>)}
                    <td>{s.par}</td>
                  </tr>
                  <tr>
                    <th className="text-left text-xs font-medium text-muted-foreground">You</th>
                    {holes.map((h) => {
                      const score = counted(round, h.number);
                      return (
                        <td key={h.number} className="py-1">
                          <button type="button" onClick={() => onPick(h.number)} aria-label={`Hole ${h.number}${score != null ? `, ${score}` : ''}`}
                            className={cn('mx-auto grid size-7 place-content-center font-semibold', mark(score == null ? null : score - h.par),
                              h.number === round.current && 'bg-secondary')}>
                            {score ?? '·'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="font-bold">{s.n ? s.score : ''}</td>
                  </tr>
                </tbody>
              </table>
            );
          })}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Paper-card marks: circle for birdie (double for eagle), square for bogey (double for worse).
function mark(d: number | null) {
  if (d == null) return 'rounded-full text-muted-foreground';
  if (d <= -2) return 'rounded-full border-[3px] border-double border-primary text-primary';
  if (d === -1) return 'rounded-full border border-primary text-primary';
  if (d === 0) return 'rounded-full';
  if (d === 1) return 'rounded-sm border border-foreground/60';
  return 'rounded-sm border-[3px] border-double border-foreground/60';
}
