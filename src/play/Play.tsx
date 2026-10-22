import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Flag, Map as MapIcon, Minus, MoreHorizontal, Plus, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Empty } from '@/components/page';
import { Button } from '@/components/ui/button';
import { SyncStatus } from '@/components/data-status';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { go } from '../lib/nav';
import { clubStats, clubYards, PUTTER, shortName, shotYards, suggestClub } from '../lib/clubs';
import { getCourse } from '../lib/courses';
import { elevationFt, playsLike } from '../lib/elevation';
import { centroid, distM, distYd, frontBack, M_TO_YD, nearestOnLine, pointAhead, pointInPolygon, type LngLat } from '../lib/geo';
import * as R from '../lib/round';
import { saveRound, setActive, useStore } from '../lib/store';
import type { Hole } from '../schemas/course';
import { HoleMap, labelAt } from './HoleMap';
import { HoleReview } from './HoleReview';
import { useGeolocation, useWakeLock } from './useGeolocation';

const SIM = new URLSearchParams(location.search).has('sim');
const NEAR_HOLE_YD = 650; // farther than this from the green, measure from the tee
const yd = (n: number | null | undefined) => (n == null ? '–' : Math.round(n));

export function Play({ roundId }: { roundId: string }) {
  const round = useStore((s) => s.rounds[roundId]);
  const bag = useStore((s) => s.bag);
  const rounds = useStore((s) => s.rounds);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);
  const course = getCourse(round.courseId);
  const { fix, error, inject } = useGeolocation();
  useWakeLock();

  const [target, setTarget] = useState<LngLat | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [pinElev, setPinElev] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [tools, setTools] = useState(false);
  const [reviewHole, setReviewHole] = useState<number | null>(null);
  const [clubs, setClubs] = useState(false);
  const [puttsOpen, setPuttsOpen] = useState(false);
  const [viewPick, setViewPick] = useState<'hole' | 'green' | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [cardH, setCardH] = useState(0);
  const [hereElev, setHereElev] = useState<number | null>(null);
  const lastTap = useRef<{ type: 'shot' | 'putt'; at: number } | null>(null);

  const hole = course?.holes.find((h) => h.number === round.current);
  const hs = round.holes[round.current] ?? R.emptyHole();
  const correction = hs.correction;
  const recordingFix = correction ? { pos: correction.pos, acc: correction.acc, t: correction.t } : fix;
  const pin = hs.pin ?? hole?.green.center ?? [0, 0];
  const teePos: LngLat | undefined = hole && (hole.tees?.[round.teeId]?.pos ?? hole.path?.[0]);
  const live = !!(recordingFix && hole && distYd(recordingFix.pos, hole.green.center) < NEAR_HOLE_YD);
  const from: LngLat = correction?.pos ?? (live ? recordingFix!.pos : teePos ?? hole?.green.center ?? [0, 0]);

  // Elevation: ground at the pin, and at you (or the tee when you're not on the hole).
  useEffect(() => {
    setPinElev(hs.pin ? null : hole?.green.elevFt?.center ?? null);
    let stale = false;
    void elevationFt(pin).then((v) => !stale && v != null && setPinElev(v));
    return () => { stale = true; };
  }, [pin[0], pin[1]]);
  const fromKey = correction || live ? `${from[0].toFixed(4)},${from[1].toFixed(4)}` : `tee${round.current}`;
  useEffect(() => {
    if (!live && !correction) return setHereElev(hole?.tees?.[round.teeId]?.elevFt ?? null);
    setHereElev(null);
    let stale = false;
    void elevationFt(from).then((v) => !stale && setHereElev(v));
    return () => { stale = true; };
  }, [fromKey]);

  // New hole: clear the target, manual club pick and camera choice.
  useEffect(() => { setTarget(null); setPicked(null); setViewPick(null); lastTap.current = null; }, [round.current]);

  // Fit the hole into what the bottom card leaves visible.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCardH(Math.round(el.offsetHeight / 20) * 20));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!hole]);

  if (!course || !hole) {
    return (
      <Empty icon={<Flag />} title="This course isn't installed" action={<Button className="rounded-full" onClick={() => { setActive(null); go('golf'); }}>Back to My golf</Button>}>
        The round was started at {round.courseId}, which has no hole map here.
      </Empty>
    );
  }

  const save = (r: typeof round, push = false) => saveRound(r, { push });
  const dPin = distYd(from, pin);
  const fb = hole.green.polygon ? frontBack(from, pin, hole.green.polygon) : null;
  const onGreen = live && !!hole.green.polygon && pointInPolygon(from, hole.green.polygon);
  const dz = pinElev != null && hereElev != null ? pinElev - hereElev : null;
  // Out of reach: aim where your longest club lands on the centerline (drag or tap the map to change it).
  const reach = onGreen ? null : suggestClub(dPin, bag, stats)?.club.yards;
  const layup = !target && reach && hole.path && dPin > reach + 10 ? pointAhead(hole.path, from, reach / M_TO_YD) : null;
  const aimAt = target ?? layup;
  const aim = aimAt ? distYd(from, aimAt) : dz != null ? playsLike(dPin, hereElev!, pinElev!) : dPin;
  const sug = onGreen ? null : suggestClub(aim, bag, stats);
  const club = picked ?? correction?.club ?? sug?.club.id ?? null;
  // Close to the pin, putting is the next thing: the big button becomes Putts and the map zooms in.
  const nearGreen = live && !correction && (onGreen || dPin < 25);
  const clubName = bag.clubs.find((c) => c.id === club)?.name ?? club;
  const clubYds = (() => { const c = bag.clubs.find((c) => c.id === club); return c && c.id !== PUTTER ? clubYards(c, stats, bag.useTracked) : null; })();
  // Near the green the map zooms in on its own; the flag button overrides until the next hole.
  const view = viewPick ?? (nearGreen ? 'green' : 'hole');
  const last = round.current === course.holes.at(-1)!.number;
  const played = R.playedHoles(round);
  // The score circle counts finished holes only, so a hole in progress doesn't read as -3.
  const scored = played.filter(([n, h]) => h.completed || Number(n) !== round.current);
  const scoredToPar = scored.reduce((s, [n, h]) => s + R.holeScore(h) - (round.pars[n] ?? 0), 0);
  const previousCompleted = course.holes.filter(h => h.number !== round.current && round.holes[h.number]?.completed).at(-1);
  const reviewed = reviewHole == null ? null : course.holes.find(h => h.number === reviewHole);

  function allowStroke(type: 'shot' | 'putt') {
    const now = Date.now();
    if (lastTap.current?.type === type && now - lastTap.current.at < 1_200) {
      toast.message('Already counted. Use Undo to correct the last stroke.');
      return false;
    }
    lastTap.current = { type, at: now };
    return true;
  }

  function putt() {
    if (!allowStroke('putt')) return;
    save(R.putt(round, recordingFix?.pos ?? null, recordingFix?.acc, recordingFix?.t));
    setPicked(null); setTarget(null);
    setRecenter((n) => n + 1); // re-frame from where you are now
  }

  function undo() {
    save(R.undo(round));
    setPicked(null); setTarget(null); lastTap.current = null;
  }

  function mark(force = false) {
    if (!club) return;
    if (club === PUTTER) return putt();
    if (!recordingFix) return void toast.error('No GPS position yet. Give it a few seconds outside.');
    if (recordingFix.acc > 25 && !force) {
      return void toast.warning(`GPS is only accurate to ±${Math.round(recordingFix.acc * M_TO_YD)} y`, { action: { label: 'Mark anyway', onClick: () => mark(true) } });
    }
    if (!allowStroke('shot')) return;
    save(R.markShot(round, club, recordingFix.pos, recordingFix.acc));
    setPicked(null);
    setTarget(null);
    setRecenter((n) => n + 1);
  }

  function step(d: number) {
    const nums = course!.holes.map((h) => h.number);
    const i = nums.indexOf(round.current) + d;
    if (i >= 0 && i < nums.length) save({ ...round, current: nums[i], updatedAt: new Date().toISOString() });
  }

  // "I took n putts": the hole is done. Say how it went, then move to the next tee.
  function finishHole(n: number) {
    if (!puttsOpen) return; // a second tap while the sheet closes
    setPuttsOpen(false);
    const r = R.setPutts(round, n, live ? recordingFix?.pos ?? null : null, pin);
    const strokes = R.holeScore(r.holes[round.current]);
    toast.success(`Hole ${hole!.number}: ${strokes} strokes · ${scoreName(strokes - hole!.par)}`);
    if (!last) {
      const nums = course!.holes.map((h) => h.number);
      return save({ ...r, current: nums[nums.indexOf(round.current) + 1] }, true);
    }
    save(r);
    setFinishing(true);
  }

  function finish() {
    save({ ...round, done: true, updatedAt: new Date().toISOString() }, true);
    setActive(null);
    go(`golf/round/${round.id}`);
  }

  // Leaving keeps the round going (the strip at the top of the app resumes it).
  const leave = () => go(round.gameId ? `games/${round.gameId}` : 'golf');
  const open = hs.shots.at(-1)?.end === null ? hs.shots.at(-1)! : null; // hit, not yet measured
  const hint = correction ? 'Stroke removed. Pick the club and Save, or use live GPS.'
    : hs.completed ? `Done · ${R.holeScore(hs)} strokes · ${scoreName(R.holeScore(hs) - hole.par)}`
    : nearGreen ? 'Holed out? Tap Putts.'
    : open ? (live && fix ? `${shortName(bag.clubs.find((c) => c.id === open.club)?.name ?? open.club)} · ${yd(distYd(open.pos, fix.pos))} y so far · tap Shot at your ball` : `Shot ${hs.shots.length} started. Walk to your ball.`)
    : played.length ? '' : 'At your ball? Tap Shot before you swing.';
  const gpsNote = error ? `GPS: ${error}` : !fix ? (SIM ? 'Sim: long-press to place yourself' : 'Finding GPS…')
    : fix.acc > 15 ? `GPS ±${Math.round(fix.acc * M_TO_YD)} y` : !live ? 'Off the hole · from the tee' : null;

  const shotButton = (big: boolean) => (
    <Button variant={big ? 'default' : 'secondary'} className={cn('shrink-0 rounded-full font-bold', big ? 'size-[4.5rem] text-base shadow-lg' : 'size-14 text-sm')}
      aria-describedby="shot-feedback" onClick={() => mark()} disabled={!club}
      aria-label={correction ? `Save correction · ${club === PUTTER ? 'Putt' : clubName ?? '–'}` : `Start shot · ${clubName ?? '–'}`}>
      <span className="grid leading-none">{correction ? 'Save' : 'Shot'}<span className="mt-1 text-[0.625rem] font-semibold opacity-80">#{R.holeScore(hs) + 1}</span></span>
    </Button>
  );
  const puttsButton = (big: boolean) => (
    <Button variant={big ? 'default' : 'secondary'} className={cn('shrink-0 rounded-full font-bold', big ? 'size-[4.5rem] text-base shadow-lg' : 'size-14 text-sm')}
      aria-label="Putts (finishes the hole)" onClick={() => setPuttsOpen(true)}>Putts</Button>
  );

  return (
    <div className="play relative h-dvh overflow-hidden bg-black" style={{ '--card-h': `${cardH}px` } as React.CSSProperties}>
      <div className="absolute inset-0">
        <HoleMap
          hole={hole} from={from} here={fix?.pos ?? null} hereAcc={fix?.acc} savedPosition={correction?.pos} pin={pin} target={aimAt} recenter={recenter}
          view={view} padBottom={cardH} hazards={view === 'hole' ? hazardsAhead(hole, from, pin, aim) : []}
          labels={aimAt ? [labelAt(from, aimAt, String(yd(distYd(from, aimAt)))), labelAt(aimAt, pin, String(yd(distYd(aimAt, pin))))] : []}
          shotLines={hs.shots.filter((s) => s.end).map((s) => [s.pos, s.end!])}
          shotTags={hs.shots.map((s) => ({ pos: s.pos, text: `${shortName(bag.clubs.find((c) => c.id === s.club)?.name ?? s.club)}${s.end ? ` ${yd(shotYards(s))}y` : ''}` }))}
          onTap={setTarget}
          onTargetMove={setTarget}
          onClearTarget={() => setTarget(null)}
          onPinMove={(p) => save(R.setPin(round, p))}
          onLongPress={SIM ? (p) => inject(p, 3) : undefined}
        />
      </div>

      {/* Top: leave, and the hole (arrows step through). */}
      <header className="absolute inset-x-0 top-0 flex items-start gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <Circle aria-label="Leave the map (the round keeps going)" onClick={leave}><X /></Circle>
        <div className={cn('flex h-12 min-w-0 flex-1 items-center rounded-full', GLASS)}>
          <Button variant="ghost" size="icon" className="size-12 shrink-0 rounded-full" aria-label="Previous hole" onClick={() => step(-1)}><ChevronLeft /></Button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <p className="truncate text-base font-bold">Hole {hole.number}</p>
            <p className="truncate text-xs text-muted-foreground">Par {hole.par}{hole.yards?.[round.teeId] ? ` · ${hole.yards[round.teeId]} y` : ''}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-12 shrink-0 rounded-full" aria-label="Next hole" onClick={() => step(1)}><ChevronRight /></Button>
        </div>
      </header>

      {/* Map controls: a column of round buttons on the right, out of the way of the hole. */}
      <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] grid gap-2.5">
        <Circle aria-label={view === 'green' ? 'Show the whole hole' : 'Zoom to the green'} aria-pressed={view === 'green'} onClick={() => setViewPick(view === 'green' ? 'hole' : 'green')}>
          {view === 'green' ? <MapIcon /> : <Flag />}
        </Circle>
        <Circle aria-label="Recenter" onClick={() => { setTarget(null); setRecenter((n) => n + 1); }}><Crosshair /></Circle>
      </div>
      {gpsNote && <span role="status" style={{ bottom: cardH + 12 }} className={cn('absolute left-1/2 max-w-[80%] -translate-x-1/2 truncate rounded-full px-3 py-1.5 text-xs font-medium',
        error || (fix && fix.acc > 15) ? 'bg-orange-soft text-warning' : GLASS)}>{gpsNote}</span>}

      {/* Bottom card: the numbers, then one row of round controls. */}
      <section ref={cardRef} className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_30px_rgb(0_0_0/0.25)]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end tabular-nums">
          <p className="text-center leading-none">{fb && <><b className="text-2xl">{yd(fb.front * M_TO_YD)}</b><span className="mt-1 block text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">Front</span></>}</p>
          <p className="px-3 text-center leading-none">
            <b className="text-6xl font-extrabold tracking-tight">{yd(dPin)}</b>
            <span className="mt-1 block text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">{correction ? 'Pin · saved spot' : hs.pin ? 'Pin' : 'Center'}</span>
          </p>
          <p className="text-center leading-none">{fb && <><b className="text-2xl">{yd(fb.back * M_TO_YD)}</b><span className="mt-1 block text-[0.625rem] font-semibold tracking-wide text-muted-foreground uppercase">Back</span></>}</p>
        </div>
        <p className="mt-1.5 min-h-4 text-center text-xs text-muted-foreground">
          {aimAt ? `${target ? 'Target' : 'Layup'} ${yd(aim)} · leaves ${yd(distYd(aimAt, pin))} · drag to move`
            : view === 'green' ? greenTilt(hole) ?? ''
            : dz != null && Math.abs(dz) >= 1 ? `Plays ${yd(aim)} (${dz > 0 ? '↑' : '↓'}${Math.abs(dz).toFixed(0)} ft)` : ''}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <Circle card aria-label="Undo last action" disabled={!hs.log.length} onClick={undo}><Undo2 /></Circle>
          <Circle card aria-label={`Change club (${clubName ?? 'none'})`} onClick={() => setClubs(true)} className={cn(sug && club === sug.club.id && 'ring-2 ring-orange')}>
            <span className="grid leading-none"><b className="text-sm">{club ? shortName(clubName ?? club) : 'Club'}</b>{clubYds && <span className="text-[0.625rem] text-muted-foreground tabular-nums">{clubYds}</span>}</span>
          </Circle>
          {nearGreen ? puttsButton(true) : shotButton(true)}
          {nearGreen ? shotButton(false) : puttsButton(false)}
          <Circle card aria-label="Hole tools and penalties" onClick={() => setTools(true)}><MoreHorizontal /></Circle>
        </div>

        <p id="shot-feedback" role="status" aria-label="Shot guidance" className="mt-2 min-h-4 text-center text-xs text-muted-foreground">
          {hint}
        </p>
        {correction && <Button variant="ghost" className="mt-1 min-h-11 w-full rounded-full" onClick={() => { save(R.editHole(round, h => { delete h.correction; })); setPicked(null); setTarget(null); lastTap.current = null; }}>Use live GPS</Button>}
        <SyncStatus quiet />
      </section>

      <Drawer open={clubs} onOpenChange={setClubs}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Club</DrawerTitle><DrawerDescription>{sug ? `${sug.club.name} gets you ${yd(aim)}.` : 'Pick what you are hitting.'}</DrawerDescription></DrawerHeader>
          <div className="grid grid-cols-4 justify-items-center gap-3 px-5 pb-6">
            {bag.clubs.filter((c) => c.on && c.id !== PUTTER).map((c) => {
              const y = clubYards(c, stats, bag.useTracked);
              const on = c.id === club;
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => { setPicked(c.id); setClubs(false); }}
                  className={cn('grid size-16 place-content-center rounded-full border text-center leading-tight',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                    !on && c.id === sug?.club.id && 'border-orange ring-2 ring-orange')}>
                  <span className="text-sm font-semibold">{shortName(c.name)}</span>
                  {y && <span className={cn('text-xs tabular-nums', on ? 'opacity-90' : 'text-muted-foreground')}>{y}</span>}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={puttsOpen} onOpenChange={setPuttsOpen}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Putts on hole {hole.number}</DrawerTitle>
            <DrawerDescription>{R.holeScore(hs) - hs.putts} {R.holeScore(hs) - hs.putts === 1 ? 'stroke' : 'strokes'} to the green. Picking finishes the hole.</DrawerDescription></DrawerHeader>
          <div className="flex justify-center gap-3 px-5">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-label={`${n} ${n === 1 ? 'putt' : 'putts'}`} onClick={() => finishHole(n)}
                className={cn('grid size-16 place-content-center rounded-full border bg-background text-2xl font-bold tabular-nums', n === 2 && 'border-primary ring-2 ring-primary')}>{n}</button>
            ))}
          </div>
          <Button variant="ghost" className="mx-5 mt-3 mb-5 min-h-11 rounded-full" onClick={() => finishHole(0)}>Holed it from off the green (no putts)</Button>
        </DrawerContent>
      </Drawer>

      <Drawer open={tools} onOpenChange={setTools}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Hole {hole.number} · Par {hole.par}{hole.hcp ? ` · Hcp ${hole.hcp}` : ''}</DrawerTitle>
            <DrawerDescription>Round {scored.length ? `${R.fmtToPar(scoredToPar)} thru ${scored.length}` : 'not started'} · this hole {hs.putts} {hs.putts === 1 ? 'putt' : 'putts'}, {hs.penalties} {hs.penalties === 1 ? 'penalty' : 'penalties'}</DrawerDescription></DrawerHeader>
          <div className="space-y-4 overflow-y-auto px-5 pb-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3">
              <Button variant="outline" size="icon" className="size-12 rounded-full" aria-label="Score minus one" disabled={R.holeScore(hs) <= 0} onClick={() => save(R.adjust(round, -1))}><Minus /></Button>
              <p className="text-center"><b className="text-2xl tabular-nums">{R.holeScore(hs)}</b><span className="block text-sm text-muted-foreground">strokes</span></p>
              <Button variant="outline" size="icon" className="size-12 rounded-full" aria-label="Score plus one" onClick={() => save(R.adjust(round, 1))}><Plus /></Button>
            </div>
            <Button variant="outline" className="h-12 w-full rounded-full" onClick={() => save(R.penalty(round))}>Add a penalty stroke</Button>
            {hs.shots.length > 0 && <div>
              <p className="mb-2 text-sm text-muted-foreground">Tap a shot to mark a mishit (left out of club distances).</p>
              <div className="flex flex-wrap gap-1.5">
                {hs.shots.map((s, i) => (
                  <button key={i} type="button" aria-pressed={s.mishit} onClick={() => save(R.toggleMishit(round, i))}
                    className={cn('min-h-11 rounded-full bg-secondary px-3 py-2 text-sm text-secondary-foreground', s.mishit && 'line-through opacity-60')}>
                    {i + 1}. {shortName(bag.clubs.find((c) => c.id === s.club)?.name ?? s.club)} {s.end ? `${yd(shotYards(s))} y` : '…'}
                  </button>
                ))}
              </div>
            </div>}
            {(hs.completed || previousCompleted) && <Button variant="secondary" className="h-12 w-full rounded-full" onClick={() => { setTools(false); setReviewHole(hs.completed ? hole.number : previousCompleted!.number); }}>
              Review hole {hs.completed ? hole.number : previousCompleted!.number} · shots & yardages
            </Button>}
            <div className="grid grid-cols-2 gap-2">
              {round.gameId && <Button variant="outline" className="h-12 rounded-full" onClick={() => go(`games/${round.gameId}`)}>Leaderboard</Button>}
              <Button variant="outline" className={cn('h-12 rounded-full', !round.gameId && 'col-span-2')} onClick={() => { setTools(false); setFinishing(true); }}>End round</Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={finishing} onOpenChange={setFinishing}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Finish the round?</DrawerTitle>
            <DrawerDescription>
              {R.totalScore(round)} ({R.fmtToPar(R.toPar(round))}) over {played.length} holes at {round.courseName}.
              {round.gameId && ' It goes on the game\'s leaderboard as final.'}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="outline" className="h-12 rounded-full" onClick={() => { setFinishing(false); setReviewHole(hole.number); }}>Review hole {hole.number}</Button>
            <Button className="h-12 rounded-full text-base" onClick={finish}><Flag /> Finish round</Button>
            <Button variant="ghost" className="h-12 rounded-full" onClick={() => setFinishing(false)}>Keep playing</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {reviewed && <HoleReview key={reviewed.number} hole={reviewed} state={round.holes[reviewed.number] ?? R.emptyHole()} bag={bag} onClose={() => setReviewHole(null)} />}
    </div>
  );
}

const GLASS = 'bg-background/90 shadow-md backdrop-blur';

const scoreName = (d: number) =>
  ['Albatross', 'Eagle', 'Birdie', 'Par', 'Bogey', 'Double bogey', 'Triple bogey'][d + 3] ?? (d > 0 ? `+${d}` : `${d}`);

// The round map button: glass over the map, solid in the card.
function Circle({ card = false, className, ...p }: React.ComponentProps<typeof Button> & { card?: boolean }) {
  return <Button variant={card ? 'secondary' : 'ghost'} size="icon" className={cn('shrink-0 rounded-full', card ? 'size-14' : cn('size-12', GLASS), className)} {...p} />;
}

// Up to three bunkers or water near your line to the pin, with yards to reach–carry each.
function hazardsAhead(hole: Hole, from: LngLat, pin: LngLat, shotYd: number) {
  const toPin = distM(from, pin);
  return (hole.features ?? []).flatMap((f) => {
    if (f.type === 'fairway' || pointInPolygon(from, f.polygon)) return [];
    const c = centroid(f.polygon);
    const { d, along } = nearestOnLine(c, [from, pin]);
    if (d > 40 || along < 20 || along > toPin + 15) return [];
    const { front, back } = frontBack(from, c, f.polygon);
    if (back * M_TO_YD < Math.max(60, shotYd / 2)) return []; // carried easily: not in play
    return [{ pos: c, type: f.type, front, text: `${yd(front * M_TO_YD)}–${yd(back * M_TO_YD)}` }];
  }).sort((a, b) => a.front - b.front).slice(0, 3);
}

function greenTilt(hole: Hole) {
  const e = hole.green.elevFt;
  if (e?.front == null || e.back == null || e.left == null || e.right == null) return null;
  const part = (d: number, hi: string, lo: string) => (Math.abs(d) < 0.5 ? null : `${d > 0 ? hi : lo} ${Math.abs(d).toFixed(1)} ft`);
  const bits = [part(e.back - e.front, 'back higher', 'front higher'), part(e.right - e.left, 'right higher', 'left higher')].filter(Boolean);
  return `Green: ${bits.length ? bits.join(', ') : 'fairly flat'}`;
}
