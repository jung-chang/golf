// A game as a row in the list, and the whole game in a sheet: tee times and booking, who's in,
// round day (start your round, leaderboard) and results.
import { useState } from 'react';
import { CalendarPlus, Check, CircleCheck, ExternalLink, Flag, Search, Share2, Trophy, X } from 'lucide-react';
import { toast } from 'sonner';
import { Initials } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
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
import { googleCalendarUrl } from './calendar';
import { Leaderboard } from './Leaderboard';
import { openBooking } from './booking';

export type GameActions = {
  rsvp: (game: Game, status: 'in' | 'out') => void;
  book: (game: Game, time: GameTime, booked: boolean) => void;
  checkIn: (game: Game) => Promise<boolean>;
  cancel: (game: Game) => void;
};

const shortName = (code: string) => courseByCode(code)?.name ?? code;
const spots = (n: number) => `${n} ${n === 1 ? 'spot' : 'spots'}`;

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

/** The game's day as a little calendar tile. */
function DateTile({ date, today }: { date: string; today?: boolean }) {
  const d = new Date(`${date}T12:00:00Z`);
  return (
    <span className={cn('grid w-12 shrink-0 place-items-center rounded-xl py-1.5 leading-none', today ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground')}>
      <span className="text-[0.625rem] font-semibold tracking-wide uppercase">{today ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
      <span className="mt-0.5 text-xl font-bold">{d.getUTCDate()}</span>
    </span>
  );
}

/** Up to four players' initials, overlapping. */
function Faces({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="flex -space-x-1.5">
      {names.slice(0, 4).map((n, i) => <Initials key={i} name={n} max={1} className="size-6 text-[0.625rem] ring-2 ring-card" />)}
      {names.length > 4 && <span className="grid size-6 place-content-center rounded-full bg-muted text-[0.625rem] font-semibold ring-2 ring-card">+{names.length - 4}</span>}
    </span>
  );
}

/** One line in the Games list. The chip on the right is what it needs from you, or how it went. */
export function GameRow({ game, phase, me, onOpen }: { game: Game; phase: Phase; me: Member; onOpen: () => void }) {
  const players = ins(game);
  const mine = game.players.find((p) => p.email === me.email);
  const myScore = game.scores.find((s) => s.email === me.email);
  const winner = game.scores.find((s) => s.done && s.thru);
  const booked = game.times.every((t) => t.bookedBy);
  const times = game.times.map(timeLabel);

  let chip;
  if (phase === 'played') {
    chip = myScore?.thru
      ? <Badge variant="secondary" className="tabular-nums">{fmtToPar(myScore.toPar)}</Badge>
      : winner ? <Badge variant="secondary" className="gap-1"><Trophy className="size-3" />{winner.name}</Badge> : null;
  } else if (!mine) {
    chip = <Badge className="bg-orange font-bold text-orange-foreground">In?</Badge>;
  } else if (mine.status === 'in') {
    chip = <Badge variant="outline" className="gap-1 border-primary text-primary"><Check className="size-3" />In</Badge>;
  } else {
    chip = <Badge variant="outline" className="text-muted-foreground">Out</Badge>;
  }

  return (
    <button type="button" onClick={onOpen} className={cn('flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors active:bg-accent', phase === 'today' && 'border-primary')}>
      <DateTile date={game.date} today={phase === 'today'} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate font-semibold">{shortName(game.code)}</span>
        <span className="block truncate text-sm text-muted-foreground tabular-nums">
          {phase === 'today' ? `${times[0]} · ${countdown(game.times[0].teetime)}` : times.length > 2 ? `${times[0]} +${times.length - 1} more` : times.join(', ')}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Faces names={players.map((p) => p.name)} />
          {players.length} in{phase !== 'played' && ` · ${spots(capacity(game))}`}
        </span>
        {phase !== 'played' && <span className={cn('block text-sm font-medium', booked ? 'text-success' : 'text-warning')}>{booked ? 'Booked' : 'Booking needed · proposed'}</span>}
      </span>
      {chip}
    </button>
  );
}

/** The whole game, in a sheet. */
export function GameSheet({ game, phase, me, members, actions, onClose }: {
  game: Game | undefined; phase: Phase; me: Member; members: Member[]; actions: GameActions; onClose: () => void;
}) {
  return (
    <Drawer historyManaged open={!!game} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        {game && <GameDetail key={game.id} game={game} phase={phase} me={me} members={members} actions={actions} />}
      </DrawerContent>
    </Drawer>
  );
}

function GameDetail({ game, phase, me, members, actions }: { game: Game; phase: Phase; me: Member; members: Member[]; actions: GameActions }) {
  const nyc = courseByCode(game.code);
  const trackable = nyc?.courseId ? getCourse(nyc.courseId) : undefined;
  const myRound = useStore((s) => Object.values(s.rounds).find((r) => r.gameId === game.id));
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);

  const players = ins(game);
  const cap = capacity(game);
  const need = players.length - cap;
  const mine = game.players.find((p) => p.email === me.email);
  const imIn = mine?.status === 'in';
  const out = game.players.filter((p) => p.status === 'out');
  const waiting = phase !== 'played'
    ? members.filter((m) => !game.players.some((p) => p.email === m.email)).sort((a, b) => Number(b.email === me.email) - Number(a.email === me.email))
    : [];
  const nameOf = (m: Member) => (m.email === me.email ? 'You' : m.name || m.email.split('@')[0]);

  const begin = async (teeId: string) => {
    if (!trackable || starting) return;
    setStarting(true);
    try {
      if (!(await actions.checkIn(game))) return;
      startRound(trackable, teeId, game.id);
      setPicking(false);
      go('golf/play');
    } finally { setStarting(false); }
  };

  if (picking && trackable) {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle>Which tees?</DrawerTitle>
          <DrawerDescription>Your score shows on this game's leaderboard. Your shots stay private.</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-2 overflow-y-auto px-5">
          {trackable.tees.map((t) => {
            const yards = trackable.holes.every((h) => h.yards?.[t.id]) ? trackable.holes.reduce((s, h) => s + (h.yards?.[t.id] ?? 0), 0) : null;
            return (
              <Button key={t.id} disabled={starting} variant="outline" className="h-14 justify-start gap-3 rounded-2xl" onClick={() => void begin(t.id)}>
                <span className="size-5 rounded-full border" style={{ background: t.color }} />
                <span className="font-medium">{t.name}</span>
                {yards && <span className="text-muted-foreground">{yards} y</span>}
                {t.rating && <span className="ml-auto text-xs text-muted-foreground">{t.rating}/{t.slope}</span>}
              </Button>
            );
          })}
        </div>
        <DrawerFooter><Button variant="ghost" className="h-12 rounded-2xl" onClick={() => setPicking(false)}>Back</Button></DrawerFooter>
      </>
    );
  }

  return (
    <>
      <DrawerHeader className="flex-row items-start gap-3">
        <DateTile date={game.date} today={phase === 'today'} />
        <div className="min-w-0 flex-1">
          <DrawerTitle className="truncate">{nyc?.name ?? game.code}</DrawerTitle>
          <DrawerDescription>
            {dayLabel(game.date)} · {game.holes} holes{phase === 'upcoming' && ` · ${countdown(game.times[0].teetime)}`}
          </DrawerDescription>
        </div>
      </DrawerHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pt-2 pb-4">
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

            {game.note && <p className="rounded-xl bg-accent px-3.5 py-2.5 text-sm text-accent-foreground">{game.note}</p>}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Tee times</h3>
              <TeeTimeList game={game} me={me} onBook={(t, b) => actions.book(game, t, b)} />
            </section>

            <section className="space-y-2" aria-label="Players">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Who's in</h3>
                <span className={cn('text-xs', need > 0 ? 'font-medium text-flag' : 'text-muted-foreground')}>
                  {players.length} in · {spots(cap)}{need > 0 ? ` · ${need} without a spot` : need === 0 ? ' · full' : ''}
                </span>
              </div>
              {players.length > 0 ? (
                <div className="divide-y rounded-2xl border bg-card">
                  {players.map((p) => (
                    <div key={p.email} className="flex min-h-12 items-center gap-3 px-3.5">
                      <Initials name={p.name} />
                      <span className="flex-1 truncate text-sm">{p.email === me.email ? 'You' : p.name}</span>
                      {phase === 'today' && p.checkedIn && <span className="flex items-center gap-1 text-xs text-primary"><Check className="size-3.5" />here</span>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Nobody yet.</p>}
              {(waiting.length > 0 || out.length > 0) && (
                <p className="px-1 text-xs text-muted-foreground">
                  {waiting.length > 0 && `Waiting on ${waiting.map(nameOf).join(', ')}. `}
                  {out.length > 0 && `Out: ${out.map((p) => (p.email === me.email ? 'you' : p.name)).join(', ')}.`}
                </p>
              )}
              {need > 0 && (
                <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => findAnotherTime(game, need)}>
                  <Search /> Find another tee time for {need}
                </Button>
              )}
            </section>

            {game.scores.length > 0 && <Leaderboard scores={game.scores} me={me.email} />}
          </>
        )}

        <div className="flex flex-wrap gap-x-1 border-t pt-2">
          <Button variant="ghost" className="min-h-11 text-primary" onClick={() => share(game)}><Share2 /> Share</Button>
          {phase !== 'played' && imIn && (
            <>
              {/* Same window: an iPhone home-screen app keeps its sign-in, and the phone offers "Add to Calendar". */}
              <a href={`/api/games/${game.id}/ics`} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11 text-primary')}>
                <CalendarPlus /> Apple Calendar
              </a>
              <a href={googleCalendarUrl(game)} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11 text-primary')}>
                <CalendarPlus /> Google Calendar
              </a>
            </>
          )}
          {phase !== 'played' && game.createdBy === me.email && (
            <Button variant="ghost" className="ml-auto min-h-11 text-flag" onClick={() => actions.cancel(game)}><X /> Cancel game</Button>
          )}
        </div>
      </div>

      {phase !== 'played' && !(phase === 'today' && mine?.checkedIn) && (
        <DrawerFooter className="flex-row border-t">
          <Button className="h-12 flex-1 rounded-2xl text-base" variant={imIn ? 'default' : 'outline'} aria-pressed={imIn} onClick={() => actions.rsvp(game, 'in')}>
            {imIn && <Check />} I'm in
          </Button>
          <Button className="h-12 flex-1 rounded-2xl text-base" variant={mine?.status === 'out' ? 'secondary' : 'outline'} aria-pressed={mine?.status === 'out'} onClick={() => actions.rsvp(game, 'out')}>
            Can't make it
          </Button>
        </DrawerFooter>
      )}
      {phase !== 'played' && <p className="px-5 pb-3 text-center text-sm text-muted-foreground">RSVP tells the group you're in. Reserve and pay separately on TeeItUp.</p>}
    </>
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
    <div className="space-y-3 rounded-2xl bg-primary p-4 text-primary-foreground">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xl font-bold">
          {when === 'now' ? 'Tee off now' : when === 'teed off' ? 'On the course' : `Tee off ${when}`}
        </p>
        <p className="text-sm opacity-90">{here} here</p>
      </div>
      {myRound ? (
        !myRound.done
          // Also picks it up on a phone that didn't start it (it arrived by sync).
          ? <Button variant="secondary" className="h-12 w-full rounded-xl text-base" onClick={() => { setActive(myRound.id); go('golf/play'); }}><Flag /> {myRound.label ? `Resume my round · ${myRound.label}` : 'Go to the first tee'}</Button>
          : <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => go(`golf/round/${myRound.id}`)}>My round{myRound.label && ` · ${myRound.label}`}</Button>
      ) : trackable ? (
        <Button variant="secondary" className="h-12 w-full rounded-xl text-base" onClick={onStart}><Flag /> {imIn ? 'Start my round' : "I'm playing — start my round"}</Button>
      ) : checkedIn ? (
        <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4" /> You're checked in. Shot tracking isn't set up for this course yet.</p>
      ) : (
        <Button variant="secondary" className="h-12 w-full rounded-xl text-base" onClick={onHere}><Check /> I'm here</Button>
      )}
    </div>
  );
}

function TeeTimeList({ game, me, onBook }: { game: Game; me: Member; onBook: (t: GameTime, booked: boolean) => void }) {
  const nameOf = (email: string) => game.players.find((p) => p.email === email)?.name ?? email.split('@')[0];
  return (
    <ul className="divide-y rounded-2xl border bg-card" aria-label="Tee times">
      {game.times.map((t) => (
        <li key={t.teetime} className="flex min-h-14 items-center gap-3 px-3.5 text-sm">
          <span className="text-base font-semibold tabular-nums">{timeLabel(t)}</span>
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
            <Button size="sm" className="ml-auto h-9 rounded-full px-4"
              onClick={() => openBooking({ code: game.code, date: game.date, time: t.time, teetime: t.teetime, gameId: game.id })}>
              Book <ExternalLink />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
