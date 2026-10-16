// One game through its life: buy-in and booking → round day (start your round, leaderboard) → results.
import { useState } from 'react';
import { CalendarPlus, Check, CircleCheck, ExternalLink, Flag, Search, Share2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { searchFor } from '@/features/teetimes/TeeTimes';
import { getCourse } from '@/lib/courses';
import { go } from '@/lib/nav';
import { courseByCode } from '@/lib/nyc';
import { fmtToPar, playedHoles, toPar } from '@/lib/round';
import { setActive, startRound, useStore } from '@/lib/store';
import { toMinutes } from '@/lib/teetimes';
import { cn } from '@/lib/utils';
import type { Game, GameTime, Member } from '@/schemas/group';
import { capacity, countdown, dayLabel, gameLabel, ins, type Phase, timeLabel } from './label';
import { Leaderboard } from './Leaderboard';
import { openBooking } from './booking';

export type GameActions = {
  rsvp: (game: Game, status: 'in' | 'out') => void;
  book: (game: Game, time: GameTime, booked: boolean) => void;
  checkIn: (game: Game) => Promise<boolean>;
  cancel: (game: Game) => void;
};


async function share(game: Game) {
  const url = `${location.origin}/#games/${game.id}`;
  const text = `${gameLabel(game)}. In?`;
  try {
    if (navigator.share) await navigator.share({ title: gameLabel(game), text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast.success('Link copied');
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error("Couldn't share");
  }
}

/** Search the same course and day around this game's times, for the players without a spot. */
function findAnotherTime(game: Game, need: number) {
  const first = toMinutes(game.times[0].time);
  const last = toMinutes(game.times.at(-1)!.time);
  const window: [number, number] = [Math.max(300, first - 60), Math.min(1200, last + 90)];
  searchFor({ dates: [game.date], codes: [game.code], golfers: [Math.min(4, Math.max(1, need))], holes18: game.holes === 18 }, window);
}

export function GameCard({ game, phase, me, members, focused, actions }: {
  game: Game; phase: Phase; me: Member; members: Member[]; focused: boolean; actions: GameActions;
}) {
  const nyc = courseByCode(game.code);
  const trackable = nyc?.courseId ? getCourse(nyc.courseId) : undefined;
  const myRound = useStore((s) => Object.values(s.rounds).find((r) => r.gameId === game.id));
  const [picking, setPicking] = useState(false);

  const players = ins(game);
  const cap = capacity(game);
  const need = players.length - cap;
  const mine = game.players.find((p) => p.email === me.email);
  const imIn = mine?.status === 'in';
  const waiting = phase !== 'played'
    ? members.filter((m) => !game.players.some((p) => p.email === m.email)).sort((a, b) => Number(b.email === me.email) - Number(a.email === me.email))
    : [];

  const begin = async (teeId: string) => {
    if (!trackable || !(await actions.checkIn(game))) return;
    startRound(trackable, teeId, game.id);
    setPicking(false);
    go('golf/play');
  };

  return (
    <Card id={`game-${game.id}`} className={cn('scroll-mt-4 gap-4', focused && 'ring-2 ring-primary', phase === 'today' && 'border-primary')}>
      <CardHeader className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">
            {nyc?.name ?? game.code} <span className="text-muted-foreground">({game.code})</span>
          </CardTitle>
          {phase === 'played'
            ? <Badge variant="secondary">Played</Badge>
            : <Badge variant={phase === 'today' ? 'default' : 'outline'}>{phase === 'today' ? 'Today' : countdown(game.times[0].teetime)}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{dayLabel(game.date)} · {game.holes} holes</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {phase === 'played' ? (
          game.scores.length
            ? <Leaderboard scores={game.scores} me={me.email} final />
            : <p className="text-sm text-muted-foreground">{players.map((p) => p.name).join(', ') || 'Nobody'} played. No rounds tracked.</p>
        ) : (
          <>
            {phase === 'today' && (
              <RoundDay
                game={game} imIn={imIn} checkedIn={!!mine?.checkedIn} trackable={!!trackable}
                myRound={myRound && { id: myRound.id, done: myRound.done, label: playedHoles(myRound).length ? `${fmtToPar(toPar(myRound))} thru ${playedHoles(myRound).length}` : '' }}
                onStart={() => setPicking(true)}
                onHere={() => void actions.checkIn(game)}
              />
            )}

            <TeeTimeList game={game} me={me} onBook={(t, b) => actions.book(game, t, b)} />

            <section className="space-y-2" aria-label="Players">
              <p className="text-sm font-medium">
                {players.length} in · {cap} {cap === 1 ? 'spot' : 'spots'}
                <span className="font-normal text-muted-foreground">
                  {need > 0 ? ` · ${need} without a spot` : need === 0 ? ' · full' : ` · ${-need} left`}
                </span>
              </p>
              {players.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {players.map((p) => (
                    <Badge key={p.email} variant="secondary" className="gap-1">
                      {phase === 'today' && p.checkedIn && <Check className="size-3" aria-label="here" />}
                      {p.name}
                    </Badge>
                  ))}
                </div>
              )}
              {waiting.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Waiting on: {waiting.map((m) => (m.email === me.email ? 'you' : m.name || m.email.split('@')[0])).join(', ')}
                </p>
              )}
              {need > 0 && (
                <Button variant="outline" className="min-h-11 w-full" onClick={() => findAnotherTime(game, need)}>
                  <Search /> Find another tee time for {need}
                </Button>
              )}
            </section>

            {game.scores.length > 0 && <Leaderboard scores={game.scores} me={me.email} />}

            {game.note && <p className="rounded-md bg-accent px-3 py-2 text-sm">{game.note}</p>}

            {!(phase === 'today' && mine?.checkedIn) && (
              <div className="grid grid-cols-2 gap-2">
                <Button className="min-h-11" variant={imIn ? 'default' : 'outline'} aria-pressed={imIn} onClick={() => actions.rsvp(game, 'in')}>In</Button>
                <Button className="min-h-11" variant={mine?.status === 'out' ? 'default' : 'outline'} aria-pressed={mine?.status === 'out'} onClick={() => actions.rsvp(game, 'out')}>Out</Button>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-x-1">
          <Button variant="ghost" className="min-h-11 text-primary" onClick={() => share(game)}><Share2 /> Share</Button>
          {phase !== 'played' && imIn && (
            // Same window: an iPhone home-screen app keeps its sign-in, and the phone offers "Add to Calendar".
            <a href={`/api/games/${game.id}/ics`} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11 text-primary')}>
              <CalendarPlus /> Calendar
            </a>
          )}
          {phase !== 'played' && game.createdBy === me.email && (
            <Button variant="ghost" className="ml-auto min-h-11 text-flag" onClick={() => actions.cancel(game)}><X /> Cancel</Button>
          )}
        </div>
      </CardContent>

      {trackable && (
        <Dialog open={picking} onOpenChange={setPicking}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Which tees?</DialogTitle>
              <DialogDescription>Your score shows on this game's leaderboard. Your shots stay private.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {trackable.tees.map((t) => {
                const yards = trackable.holes.every((h) => h.yards?.[t.id]) ? trackable.holes.reduce((s, h) => s + (h.yards?.[t.id] ?? 0), 0) : null;
                return (
                  <Button key={t.id} variant="outline" className="min-h-12 justify-start gap-3" onClick={() => void begin(t.id)}>
                    <span className="size-4 rounded-full border" style={{ background: t.color }} />
                    <span className="font-medium">{t.name}</span>
                    {yards && <span className="text-muted-foreground">{yards} y</span>}
                    {t.rating && <span className="ml-auto text-xs text-muted-foreground">{t.rating}/{t.slope}</span>}
                  </Button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/** Round day: countdown, and the one thing to do next. */
function RoundDay({ game, imIn, checkedIn, trackable, myRound, onStart, onHere }: {
  game: Game; imIn: boolean; checkedIn: boolean; trackable: boolean;
  myRound?: { id: string; done: boolean; label: string };
  onStart: () => void; onHere: () => void;
}) {
  const when = countdown(game.times[0].teetime);
  const here = game.players.filter((p) => p.checkedIn).length;
  return (
    <div className="space-y-3 rounded-lg bg-accent p-3 text-accent-foreground">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">
          {when === 'now' ? 'Tee off now' : when === 'teed off' ? 'On the course' : `Tee off ${when}`}
        </p>
        <p className="text-sm">{here} here</p>
      </div>
      {myRound ? (
        !myRound.done
          // Also picks it up on a phone that didn't start it (it arrived by sync).
          ? <Button className="min-h-12 w-full text-base" onClick={() => { setActive(myRound.id); go('golf/play'); }}><Flag /> {myRound.label ? `Resume my round · ${myRound.label}` : 'Go to the first tee'}</Button>
          : <Button variant="outline" className="min-h-11 w-full" onClick={() => go(`golf/round/${myRound.id}`)}>My round{myRound.label && ` · ${myRound.label}`}</Button>
      ) : trackable ? (
        <Button className="min-h-12 w-full text-base" onClick={onStart}><Flag /> {imIn ? 'Start my round' : "I'm playing — start my round"}</Button>
      ) : checkedIn ? (
        <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4" /> You're checked in. Shot tracking isn't set up for this course yet.</p>
      ) : (
        <Button className="min-h-12 w-full text-base" onClick={onHere}><Check /> I'm here</Button>
      )}
    </div>
  );
}

function TeeTimeList({ game, me, onBook }: { game: Game; me: Member; onBook: (t: GameTime, booked: boolean) => void }) {
  const nameOf = (email: string) => game.players.find((p) => p.email === email)?.name ?? email.split('@')[0];
  return (
    <ul className="divide-y rounded-lg border" aria-label="Tee times">
      {game.times.map((t) => (
        <li key={t.teetime} className="flex min-h-12 items-center gap-2 px-3 text-sm">
          <span className="font-semibold tabular-nums">{timeLabel(t)}</span>
          <span className="text-muted-foreground">{t.spots} {t.spots === 1 ? 'spot' : 'spots'}</span>
          {t.bookedBy ? (
            <span className="ml-auto flex items-center gap-1 text-primary">
              <CircleCheck className="size-4" /> {t.bookedBy === me.email ? 'You booked' : `${nameOf(t.bookedBy)} booked`}
              {t.bookedBy === me.email && (
                <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground" onClick={() => onBook(t, false)}>Undo</Button>
              )}
            </span>
          ) : (
            // TeeItUp opens; back in the app, "Did you book it?" marks it booked.
            <Button variant="secondary" size="sm" className="ml-auto min-h-11"
              onClick={() => openBooking({ code: game.code, date: game.date, time: t.time, teetime: t.teetime, gameId: game.id })}>
              Book <ExternalLink />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
