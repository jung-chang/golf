// Scores from rounds started from a game: score to par and holes played, never shots.
import { Trophy } from 'lucide-react';
import { fmtToPar } from '@/lib/round';
import { cn } from '@/lib/utils';
import type { GameScore } from '@/schemas/group';

export function Leaderboard({ scores, me, final }: { scores: GameScore[]; me: string; final?: boolean }) {
  if (!scores.length) return null;
  // Ties share a place: +2, +2, +5 → 1, 1, 3. No place until you've played a hole (they sort last).
  const place = (i: number) => (scores[i].thru ? scores.findIndex((s) => s.thru && s.toPar === scores[i].toPar) + 1 : null);
  return (
    <ol className="divide-y rounded-lg border bg-background" aria-label={final ? 'Results' : 'Leaderboard'}>
      {scores.map((s, i) => (
        <li key={s.email} className={cn('flex min-h-11 items-center gap-3 px-3 text-sm', s.email === me && 'bg-accent/60')}>
          <span className="w-5 text-right text-muted-foreground tabular-nums">{place(i) ?? ''}</span>
          <span className="min-w-0 flex-1 truncate font-medium">
            {s.name}
            {final && place(i) === 1 && s.done && <Trophy className="ml-1.5 inline size-4 text-primary align-text-bottom" aria-label="winner" />}
          </span>
          <span className="w-10 text-right font-semibold tabular-nums">{s.thru ? fmtToPar(s.toPar) : '–'}</span>
          <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
            {s.done ? `F · ${s.strokes}` : s.thru ? `thru ${s.thru}` : 'teeing off'}
          </span>
        </li>
      ))}
    </ol>
  );
}
