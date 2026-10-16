import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Flag, Minus, MoreHorizontal, Plus, Undo2, X } from 'lucide-react';
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
import { distYd, frontBack, M_TO_YD, pointInPolygon, type LngLat } from '../lib/geo';
import * as R from '../lib/round';
import { saveRound, setActive, useStore } from '../lib/store';
import type { Hole } from '../schemas/course';
import { HoleMap, labelAt } from './HoleMap';
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
  const [hereElev, setHereElev] = useState<number | null>(null);

  const hole = course?.holes.find((h) => h.number === round.current);
  const hs = round.holes[round.current] ?? R.emptyHole();
  const pin = hs.pin ?? hole?.green.center ?? [0, 0];
  const teePos: LngLat | undefined = hole && (hole.tees?.[round.teeId]?.pos ?? hole.path?.[0]);
  const live = !!(fix && hole && distYd(fix.pos, hole.green.center) < NEAR_HOLE_YD);
  const from: LngLat = live ? fix!.pos : teePos ?? hole?.green.center ?? [0, 0];

  // Elevation: ground at the pin, and at you (or the tee when you're not on the hole).
  useEffect(() => {
    setPinElev(hs.pin ? null : hole?.green.elevFt?.center ?? null);
    let stale = false;
    void elevationFt(pin).then((v) => !stale && v != null && setPinElev(v));
    return () => { stale = true; };
  }, [pin[0], pin[1]]);
  const fromKey = live ? `${fix!.pos[0].toFixed(4)},${fix!.pos[1].toFixed(4)}` : `tee${round.current}`;
  useEffect(() => {
    if (!live) return setHereElev(hole?.tees?.[round.teeId]?.elevFt ?? null);
    let stale = false;
    void elevationFt(from).then((v) => !stale && setHereElev(v));
    return () => { stale = true; };
  }, [fromKey]);

  // New hole: clear the target and manual club pick.
  useEffect(() => { setTarget(null); setPicked(null); }, [round.current]);

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
  const aim = target ? distYd(from, target) : dz != null ? playsLike(dPin, hereElev!, pinElev!) : dPin;
  const sug = onGreen ? null : suggestClub(aim, bag, stats);
  const club = picked ?? (onGreen ? PUTTER : sug?.club.id ?? null);
  const clubName = bag.clubs.find((c) => c.id === club)?.name;
  const last = round.current === course.holes.at(-1)!.number;
  const played = R.playedHoles(round);

  function mark(force = false) {
    if (!club) return;
    if (club === PUTTER) return save(R.putt(round, fix?.pos ?? null));
    if (!fix) return void toast.error('No GPS position yet. Give it a few seconds outside.');
    if (fix.acc > 25 && !force) {
      return void toast.warning(`GPS is only accurate to ±${Math.round(fix.acc * M_TO_YD)} y`, { action: { label: 'Mark anyway', onClick: () => mark(true) } });
    }
    save(R.markShot(round, club, fix.pos, fix.acc));
    setPicked(null);
    setTarget(null);
  }

  function step(d: number) {
    const nums = course!.holes.map((h) => h.number);
    const i = nums.indexOf(round.current) + d;
    if (i >= 0 && i < nums.length) save({ ...round, current: nums[i], updatedAt: new Date().toISOString() });
  }

  function done() {
    const r = R.holeDone(round, pin);
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
  const glass = 'bg-background/90 shadow-md backdrop-blur';

  return (
    <div className="play relative h-dvh overflow-hidden bg-black">
      <div className="absolute inset-0">
        <HoleMap
          hole={hole} from={from} here={fix?.pos ?? null} pin={pin} target={target} recenter={recenter}
          labels={target ? [labelAt(from, target, String(yd(distYd(from, target)))), labelAt(target, pin, String(yd(distYd(target, pin))))] : []}
          shotLines={hs.shots.filter((s) => s.end).map((s) => [s.pos, s.end!])}
          onTap={setTarget}
          onClearTarget={() => setTarget(null)}
          onPinMove={(p) => save(R.setPin(round, p))}
          onLongPress={SIM ? (p) => inject(p, 3) : undefined}
        />
      </div>

      {/* Top: leave, the hole (swipe through with the arrows), your score. */}
      <header className="absolute inset-x-0 top-0 flex items-start gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <Button variant="ghost" size="icon" className={cn('size-11 shrink-0 rounded-full', glass)} aria-label="Leave the map (the round keeps going)" onClick={leave}><X /></Button>
        <div className={cn('flex min-w-0 flex-1 items-center rounded-full', glass)}>
          <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Previous hole" onClick={() => step(-1)}><ChevronLeft /></Button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <p className="truncate text-sm font-bold">Hole {hole.number} · Par {hole.par}</p>
            <p className="truncate text-xs text-muted-foreground">
              {hole.yards?.[round.teeId] ? `${hole.yards[round.teeId]} y` : round.teeName}{hole.hcp ? ` · HCP ${hole.hcp}` : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Next hole" onClick={() => step(1)}><ChevronRight /></Button>
        </div>
        <a href={round.gameId ? `#games/${round.gameId}` : undefined} className={cn('grid h-11 min-w-11 shrink-0 place-content-center rounded-full px-3 text-center leading-none', glass)}>
          <span className="text-sm font-bold tabular-nums">{played.length ? R.fmtToPar(R.toPar(round)) : 'E'}</span>
          <span className="text-[0.625rem] text-muted-foreground">{played.length ? `thru ${played.length}` : 'start'}</span>
        </a>
      </header>

      <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] flex items-center justify-between">
        <span className={cn('mr-2 max-w-[calc(100%-3.5rem)] rounded-xl px-2.5 py-1 text-sm font-medium', fix && fix.acc > 15 || error ? 'bg-orange-soft text-warning' : glass)}>
          {error ? `GPS: ${error}` : fix ? `${live ? '' : 'Off the hole · from the tee · '}GPS ±${Math.round(fix.acc * M_TO_YD)} y`
            : SIM ? 'Sim: long-press to place yourself' : 'Finding GPS…'}
        </span>
        <Button variant="ghost" size="icon" className={cn('size-11 shrink-0 rounded-full', glass)} aria-label="Recenter" onClick={() => setRecenter((n) => n + 1)}><Crosshair /></Button>
      </div>

      {/* Bottom card: the number, the club, the one button. */}
      <section className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-y-auto rounded-t-3xl bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_30px_rgb(0_0_0/0.25)]">
        <div className="flex items-end gap-4">
          <div className="leading-none">
            <p className="text-6xl font-extrabold tracking-tight tabular-nums">{yd(dPin)}</p>
            <p className="mt-1 text-xs text-muted-foreground">yards to pin</p>
          </div>
          {fb && (
            <div className="grid gap-1 pb-1 text-sm tabular-nums">
              <p><span className="mr-1.5 text-xs text-muted-foreground">Back</span><b>{yd(fb.back * M_TO_YD)}</b></p>
              <p><span className="mr-1.5 text-xs text-muted-foreground">Front</span><b>{yd(fb.front * M_TO_YD)}</b></p>
            </div>
          )}
          <div className="ml-auto grid justify-items-end gap-1 pb-1 text-right text-sm">
            {sug && <p className="rounded-full bg-orange-soft px-2.5 py-0.5 font-semibold text-orange-strong">{sug.club.name} · {sug.club.yards}</p>}
            {!target && dz != null && Math.abs(dz) >= 1 && <p className="text-xs text-muted-foreground">Plays {yd(aim)} ({dz > 0 ? '↑' : '↓'}{Math.abs(dz).toFixed(0)} ft)</p>}
            {target && <p className="text-xs text-muted-foreground">Target {yd(aim)} · then {yd(distYd(target, pin))}</p>}
          </div>
        </div>
        <GreenTilt hole={hole} />
        {played.length === 0 && hs.shots.length === 0 && hs.putts === 0 && <p className="mt-2 text-sm text-muted-foreground">At your ball, choose a club and mark the shot before you hit. Tap Putt on the green.</p>}

        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {bag.clubs.filter((c) => c.on).map((c) => {
            const y = clubYards(c, stats, bag.useTracked);
            const on = c.id === club;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setPicked(c.id)}
                className={cn('grid h-12 min-w-12 shrink-0 place-content-center rounded-xl border px-2 text-center leading-tight',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background',
                  !on && c.id === sug?.club.id && 'border-orange ring-1 ring-orange')}>
                <span className="text-sm font-semibold">{shortName(c.name)}</span>
                {y && <span className={cn('text-xs tabular-nums', on ? 'opacity-90' : 'text-muted-foreground')}>{y}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex gap-2">
          <Button className="h-14 flex-1 rounded-2xl text-base" onClick={() => mark()} disabled={!club}>
            {club === PUTTER ? 'Putt' : `Mark shot · ${clubName ?? '–'}`}
          </Button>
          {club !== PUTTER && <Button variant="outline" className="h-14 rounded-2xl px-4" onClick={() => save(R.putt(round, fix?.pos ?? null))}>Putt</Button>}
          <Button variant="outline" size="icon" className="size-14 rounded-2xl" aria-label="Undo last action" disabled={!hs.log.length} onClick={() => save(R.undo(round))}><Undo2 /></Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-sm"><b>{R.holeScore(hs)}</b> strokes · {hs.putts} {hs.putts === 1 ? 'putt' : 'putts'}</p>
          <Button variant="ghost" size="icon" className="size-11 rounded-xl" aria-label="Hole tools and penalties" onClick={() => setTools(true)}><MoreHorizontal /></Button>
          <Button variant="secondary" className="h-11 rounded-2xl px-4 font-semibold" aria-label={last ? 'Hole done, finish the round' : 'Hole done, go to the next'} onClick={done}>
            {last ? 'Finish' : 'Next hole'} <ChevronRight />
          </Button>
        </div>

        {hs.shots.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Shots on this hole (tap to mark a mishit)">
            {hs.shots.map((s, i) => (
              <button key={i} type="button" onClick={() => save(R.toggleMishit(round, i))}
                className={cn('min-h-11 rounded-full bg-secondary px-3 py-2 text-sm text-secondary-foreground', s.mishit && 'line-through opacity-60')}>
                {i + 1}. {shortName(bag.clubs.find((c) => c.id === s.club)?.name ?? s.club)} {s.end ? `${yd(shotYards(s))} y` : '…'}
              </button>
            ))}
            <span className="self-center text-sm text-muted-foreground">Tap a shot to mark a mishit</span>
          </div>
        )}
        <SyncStatus />
      </section>

      <Drawer open={tools} onOpenChange={setTools}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Hole {hole.number} tools</DrawerTitle><DrawerDescription>Adjust a missed stroke or add a penalty. Your shots stay saved.</DrawerDescription></DrawerHeader>
          <div className="space-y-4 overflow-y-auto px-5 pb-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3">
              <Button variant="outline" size="icon" className="size-12" aria-label="Score minus one" disabled={R.holeScore(hs) <= 0} onClick={() => save(R.adjust(round, -1))}><Minus /></Button>
              <p className="text-center"><b className="text-2xl tabular-nums">{R.holeScore(hs)}</b><span className="block text-sm text-muted-foreground">strokes</span></p>
              <Button variant="outline" size="icon" className="size-12" aria-label="Score plus one" onClick={() => save(R.adjust(round, 1))}><Plus /></Button>
            </div>
            <Button variant="outline" className="h-12 w-full rounded-xl" onClick={() => save(R.penalty(round))}>Add a penalty stroke</Button>
            <p className="text-sm text-muted-foreground">{hs.penalties} penalty {hs.penalties === 1 ? 'stroke' : 'strokes'} on this hole.</p>
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
            <Button className="h-12 rounded-2xl text-base" onClick={finish}><Flag /> Finish round</Button>
            <Button variant="ghost" className="h-12 rounded-2xl" onClick={() => setFinishing(false)}>Keep playing</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function GreenTilt({ hole }: { hole: Hole }) {
  const e = hole.green.elevFt;
  if (e?.front == null || e.back == null || e.left == null || e.right == null) return null;
  const part = (d: number, hi: string, lo: string) => (Math.abs(d) < 0.5 ? null : `${d > 0 ? hi : lo} ${Math.abs(d).toFixed(1)} ft`);
  const bits = [part(e.back - e.front, 'back higher', 'front higher'), part(e.right - e.left, 'right higher', 'left higher')].filter(Boolean);
  return <p className="mt-1 text-xs text-muted-foreground">Green: {bits.length ? bits.join(', ') : 'fairly flat'}</p>;
}
