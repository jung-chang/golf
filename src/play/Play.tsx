import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CloudOff, Crosshair, Flag, Loader2, LocateOff, Map as MapIcon, Minus, MoreHorizontal, Plus, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Empty } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { go } from '../lib/nav';
import { clubStats, clubYards, PUTTER, shortName, shotYards, suggestClub } from '../lib/clubs';
import { getCourse } from '../lib/courses';
import { elevationFt, playsLike } from '../lib/elevation';
import { centroid, distM, distYd, frontBack, M_TO_YD, nearestOnLine, pointAhead, pointInPolygon, type LngLat } from '../lib/geo';
import * as R from '../lib/round';
import { saveRound, setActive, sync, useStore } from '../lib/store';
import type { Hole } from '../schemas/course';
import { HoleMap, labelAt } from './HoleMap';
import { HoleReview } from './HoleReview';
import { Scorecard } from './Scorecard';
import { useGeolocation, useWakeLock } from './useGeolocation';

const SIM = new URLSearchParams(location.search).has('sim');
const NEAR_HOLE_YD = 650; // farther than this from the green, measure from the tee
const yd = (n: number | null | undefined) => (n == null ? '–' : Math.round(n));

export function Play({ roundId }: { roundId: string }) {
  const round = useStore((s) => s.rounds[roundId]);
  const bag = useStore((s) => s.bag);
  const rounds = useStore((s) => s.rounds);
  const syncStatus = useStore((s) => s.syncStatus);
  const saveError = useStore((s) => s.saveError);
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
  const [card, setCard] = useState(false);
  const [lastShot, setLastShot] = useState<string | null>(null); // "Driver · 233 y", shown briefly once measured
  const [viewPick, setViewPick] = useState<'hole' | 'green' | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  const [hereElev, setHereElev] = useState<number | null>(null);
  const lastTap = useRef<{ type: 'shot' | 'putt'; at: number } | null>(null);
  const finishedAt = useRef<{ hole: number; at: number } | null>(null);

  const hole = course?.holes.find((h) => h.number === round.current);
  const hs = round.holes[round.current] ?? R.emptyHole();
  const correction = hs.correction;
  const recordingFix = correction ? { pos: correction.pos, acc: correction.acc, t: correction.t } : fix;
  const pin = hs.pin ?? hole?.green.center ?? [0, 0];
  const teePos: LngLat | undefined = hole && (hole.tees?.[round.teeId]?.pos ?? hole.path?.[0]);
  // On this hole (by GPS, or the saved spot being corrected). Off it, yardages come from the tee and
  // shots can't be marked: a shot recorded from home would read 19,000 y and poison club distances.
  const live = !!(recordingFix && hole && distYd(recordingFix.pos, hole.green.center) < NEAR_HOLE_YD);
  const from: LngLat = live ? recordingFix!.pos : teePos ?? hole?.green.center ?? [0, 0];

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

  useEffect(() => {
    if (!lastShot) return;
    const t = setTimeout(() => setLastShot(null), 5_000);
    return () => clearTimeout(t);
  }, [lastShot]);

  // New hole: clear the target, manual club pick and camera choice.
  useEffect(() => { setTarget(null); setPicked(null); setViewPick(null); lastTap.current = null; }, [round.current]);

  // Fit the hole into what the bottom card leaves visible.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCardH(Math.round((window.innerHeight - el.getBoundingClientRect().top) / 20) * 20));
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
    save(hs.completed ? R.reopen(round) : R.undo(round)); // a finished hole reopens in one step
    setPicked(null); setTarget(null); setLastShot(null); lastTap.current = null;
  }

  function mark(force = false) {
    if (!club) return;
    if (club === PUTTER) return putt();
    if (!recordingFix) return void toast.error('No GPS position yet');
    if (!live) return void toast.error(`Not at hole ${hole!.number} by GPS, so the shot wasn't recorded`);
    if (recordingFix.acc > 25 && !force) {
      return void toast.warning(`GPS is only accurate to ±${Math.round(recordingFix.acc * M_TO_YD)} y`, { action: { label: 'Mark anyway', onClick: () => mark(true) } });
    }
    if (!allowStroke('shot')) return;
    const prev = hs.shots.at(-1);
    if (prev && !prev.end) setLastShot(`${shortName(bag.clubs.find((c) => c.id === prev.club)?.name ?? prev.club)} · ${yd(distYd(prev.pos, recordingFix.pos))} y`);
    save(R.markShot(round, club, recordingFix.pos, recordingFix.acc));
    setPicked(null);
    setTarget(null);
    setRecenter((n) => n + 1);
  }

  // Wraps (‹ 18 from hole 1), so a round started on 10 can walk 18 → 1.
  function step(d: number) {
    const nums = course!.holes.map((h) => h.number);
    const i = (nums.indexOf(round.current) + d + nums.length) % nums.length;
    save({ ...round, current: nums[i], updatedAt: new Date().toISOString() });
  }

  // "I took n putts": the hole is done. Say how it went, then move to the next tee.
  function finishHole(n: number) {
    // A second tap (sheet closing, or the bar's buttons) must not finish the hole twice.
    if (finishedAt.current && finishedAt.current.hole === round.current && Date.now() - finishedAt.current.at < 1_500) return;
    finishedAt.current = { hole: round.current, at: Date.now() };
    setPuttsOpen(false);
    // Where you stand ends the approach only if that's on or by this green (not walking to the
    // next tee) and the fix is good; otherwise leave it unmeasured rather than skew club distances.
    const byGreen = live && recordingFix && recordingFix.acc <= 25
      && ((hole!.green.polygon && pointInPolygon(recordingFix.pos, hole!.green.polygon)) || distYd(recordingFix.pos, pin) <= 30);
    const editing = !!hs.completed; // changing the count later: stay put, keep the approach as it was
    const r = R.setPutts(round, n, byGreen && !editing ? recordingFix.pos : null, pin);
    const strokes = R.holeScore(r.holes[round.current]);
    // The approach is measured now (to where you stand on the green), so say how far it went.
    const approach = open && n > 0 ? r.holes[round.current].shots.at(-1) : null;
    const measured = approach?.end ? ` · approach ${shortName(bag.clubs.find((c) => c.id === approach.club)?.name ?? approach.club)} ${yd(shotYards(approach))} y` : '';
    toast.success(`Hole ${hole!.number}: ${strokes} strokes · ${scoreName(strokes - hole!.par)}${measured}`);
    if (editing) return save(r);
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

  // A finished hole shows what happened (18Birdies style): the shots on the map, a summary in the card.
  const done = !!hs.completed && !correction;
  const clubLabel = (id: string) => shortName(bag.clubs.find((c) => c.id === id)?.name ?? id);
  const summary = [...hs.shots.map((s) => `${clubLabel(s.club)}${s.end ? ` ${yd(shotYards(s))}` : ''}`),
    ...(hs.putts ? [`${hs.putts} ${hs.putts === 1 ? 'putt' : 'putts'}`] : []),
    ...(hs.penalties ? [`${hs.penalties} pen`] : [])].join(' · ');

  // Leaving keeps the round going (the strip at the top of the app resumes it).
  const leave = () => go(round.gameId ? `games/${round.gameId}` : 'golf');
  const open = hs.shots.at(-1)?.end === null ? hs.shots.at(-1)! : null; // hit, not yet measured
  // Facts only (what's recorded, how far it's gone), never instructions.
  const hint = correction ? 'Stroke removed'
    : open && live && fix && !nearGreen && distYd(open.pos, fix.pos) >= 10
      ? `${shortName(bag.clubs.find((c) => c.id === open.club)?.name ?? open.club)} · ${yd(distYd(open.pos, fix.pos))} y so far`
    : '';
  // Shots are saved on the phone first; say so when they can't reach the server yet (or, rarely, can't save).
  const saved: { text: string; bad?: boolean } | null = saveError ? { text: 'Not saved on this phone', bad: true }
    : syncStatus === 'offline' ? { text: 'Offline · saved on this phone' }
    : syncStatus === 'error' ? { text: 'Saved on this phone · will sync' }
    : null;

  // Where the numbers come from when it isn't you: shown as a banner under the hole label.
  const awayYd = fix ? distYd(fix.pos, hole.green.center) : 0;
  const gps: { text: string; warn?: boolean; busy?: boolean } | null =
    SIM && !fix ? { text: 'Sim: long-press the map to place yourself' }
    : error ? { text: 'Location is off · yardages from the tee', warn: true }
    : !fix ? { text: 'Finding your location · yardages from the tee', busy: true }
    : !live ? { text: `${awayYd > 3_520 ? `${Math.round(awayYd / 1760)} mi away` : `Not at hole ${hole.number}`} · yardages from the tee`, warn: true }
    : fix.acc > 15 ? { text: `GPS ±${Math.round(fix.acc * M_TO_YD)} y`, warn: true }
    : null;

  const nums = course.holes.map((h) => h.number);
  const prevNo = nums[(nums.indexOf(round.current) - 1 + nums.length) % nums.length];
  const nextNo = nums[(nums.indexOf(round.current) + 1) % nums.length];
  const clubShort = club ? shortName(clubName ?? club) : null;
  // The one transient line above the bar: what just happened, else a GPS problem. Facts only.
  const note = done ? null : lastShot ? 'last' : hint;

  // 18Birdies-style yardages, drawn on the map beside the pin: back, center (with plays-like and club), front.
  const pill = done ? null : aimAt ? { label: `${target ? 'Target' : 'Layup'}${clubShort ? ` · ${clubShort}` : ''}`, text: String(yd(aim)) }
    : clubShort && !nearGreen ? { label: `Plays like · ${clubShort}`, text: String(yd(aim)) }
    : view === 'green' && mainTilt(hole) ? { label: 'Green', text: mainTilt(hole)! } : null;
  const callout = done ? null : (
    <div className="pointer-events-none grid justify-items-start gap-1.5 text-white">
      {fb && <Dist yards={yd(fb.back * M_TO_YD)} label="Back" />}
      <div className="flex items-center">
        <div data-yards="center" className={cn('relative z-[1] grid size-[72px] place-content-center rounded-full border-2 border-white text-center leading-none', MAP_DARK)}>
          <b className="text-[26px] tabular-nums">{yd(dPin)}</b>
          <span className="mt-0.5 text-[9px] tracking-wider text-white/75 uppercase">{correction ? 'Saved spot' : hs.pin ? 'Pin' : 'Center'}</span>
        </div>
        {pill && <div className="-ml-3.5 max-w-36 rounded-r-full bg-white py-1.5 pr-3 pl-5 leading-tight text-[#17251c] shadow-md">
          <span className="block text-[10px] text-[#5b6b60]">{pill.label}</span><b className="block truncate text-[15px] tabular-nums">{pill.text}</b>
        </div>}
      </div>
      {fb && <Dist yards={yd(fb.front * M_TO_YD)} label="Front" />}
    </div>
  );

  return (
    <div className="play relative h-dvh overflow-hidden bg-black" style={{ '--card-h': `${cardH}px` } as React.CSSProperties}>
      <div className="absolute inset-0">
        <HoleMap
          hole={hole} from={done ? hs.shots[0]?.pos ?? teePos ?? hole.green.center : from} here={fix?.pos ?? null} hereAcc={fix?.acc}
          savedPosition={correction?.pos} pin={pin} target={done ? null : aimAt} recenter={recenter} review={done}
          view={done ? 'hole' : view} padBottom={cardH} hazards={!done && view === 'hole' ? hazardsAhead(hole, from, pin, aim) : []}
          labels={!done && aimAt ? [labelAt(from, aimAt, String(yd(distYd(from, aimAt)))), labelAt(aimAt, pin, String(yd(distYd(aimAt, pin))))] : []}
          shotLines={hs.shots.filter((s) => s.end).map((s) => [s.pos, s.end!])}
          shotTags={[...hs.shots.map((s) => ({ pos: s.pos, text: `${clubLabel(s.club)}${s.end ? ` ${yd(shotYards(s))}y` : ''}` })),
            ...(done && hs.putts ? [{ pos: pin, text: `${hs.putts} ${hs.putts === 1 ? 'putt' : 'putts'}` }] : [])]}
          onTap={setTarget}
          onTargetMove={setTarget}
          onClearTarget={() => setTarget(null)}
          onPinMove={(p) => save(R.setPin(round, p))}
          onLongPress={SIM ? (p) => inject(p, 3) : undefined}
          pinCallout={callout}
          padTop={130 + 36 * [gps, saved].filter(Boolean).length}
        />
      </div>

      {/* Top: the hole (tap for the scorecard) and the menu. Everything else is map. */}
      <button type="button" onClick={() => setCard(true)}
        aria-label={`Hole ${hole.number}${scored.length ? `, ${R.fmtToPar(scoredToPar)} thru ${scored.length}` : ''}, scorecard`}
        className={cn('absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-3 flex items-center gap-2.5 rounded-2xl py-2 pr-3.5 pl-3 text-left text-white shadow-md', MAP_DARK)}>
        <b className="text-3xl leading-none tabular-nums">{hole.number}</b>
        <span className="text-[11px] leading-snug text-white/75">
          Par {hole.par}{hole.yards?.[round.teeId] ? ` · ${hole.yards[round.teeId]} y` : ''}
          <span className="block font-semibold text-white">{scored.length ? `${R.fmtToPar(scoredToPar)} thru ${scored.length}` : hole.hcp ? `Hcp ${hole.hcp}` : `Par ${hole.par}`}</span>
        </span>
      </button>
      <Circle aria-label="Hole tools and penalties" className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3" onClick={() => setTools(true)}><MoreHorizontal /></Circle>
      {/* Status under the hole label: where the yardages come from, and whether shots are saved. */}
      <div className="absolute top-[calc(env(safe-area-inset-top)+4.75rem)] left-3 grid max-w-[calc(100%-5.5rem)] justify-items-start gap-1.5">
        {gps && <p role="status" aria-label="Location" className={cn('flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md',
          gps.warn ? 'bg-[#ffb52e] text-[#2b1d05]' : cn(MAP_DARK, 'text-white'))}>
          {gps.busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <LocateOff className="size-3.5 shrink-0" />}
          <span className="truncate">{gps.text}</span>
        </p>}
        {saved && <p role="status" aria-label="Saving" className={cn('flex max-w-full items-center gap-2 rounded-full py-1 pr-1 pl-3 text-xs font-semibold shadow-md',
          saved.bad ? 'bg-destructive text-white' : cn(MAP_DARK, 'text-white'), !saved.bad && 'py-1.5 pr-3')}>
          <CloudOff className="size-3.5 shrink-0" /><span className="truncate">{saved.text}</span>
          {saved.bad && <button type="button" onClick={() => void sync()} className="min-h-8 rounded-full bg-white/20 px-3">Retry</button>}
        </p>}
      </div>

      {/* Bottom: one floating bar; map buttons and a one-line note sit just above it. */}
      <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="absolute bottom-full left-1 mb-3 grid gap-2.5">
          <Circle aria-label={view === 'green' ? 'Show the whole hole' : 'Zoom to the green'} aria-pressed={view === 'green'} onClick={() => setViewPick(view === 'green' ? 'hole' : 'green')}>
            {view === 'green' ? <MapIcon /> : <Flag />}
          </Circle>
          <Circle aria-label="Recenter" onClick={() => { setTarget(null); setRecenter((n) => n + 1); }}><Crosshair /></Circle>
        </div>
        {!done && <Circle aria-label="Undo last action" disabled={!hs.log.length} className="absolute right-1 bottom-full mb-3" onClick={undo}><Undo2 /></Circle>}
        <p id="shot-feedback" role="status" aria-label="Shot guidance"
          className="absolute bottom-full left-1/2 mb-4 flex max-w-[calc(100%-8.5rem)] -translate-x-1/2 justify-center text-xs font-semibold">
          {note === 'last' ? <span aria-label="Last shot" className="truncate rounded-full bg-[#f26522] px-3 py-1.5 text-white shadow-md">{lastShot}</span>
            : done ? <span aria-label="Hole summary" className={cn('truncate rounded-full px-3 py-1.5 text-white shadow-md', MAP_DARK)}>{summary || 'Score only'}</span>
            : note ? <span className={cn('truncate rounded-full px-3 py-1.5 text-white shadow-md', MAP_DARK)}>{note}</span>
            : null}
        </p>
        {correction && <Button variant="secondary" className="absolute bottom-full left-1/2 mb-12 min-h-11 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => { save(R.editHole(round, h => { delete h.correction; })); setPicked(null); setTarget(null); lastTap.current = null; }}>Use live GPS</Button>}

        <div ref={cardRef} className={cn('flex h-16 items-center justify-between rounded-full px-2 text-white shadow-xl', MAP_DARK)}>
          {done ? (<>
            <BarButton aria-label="Reopen hole" onClick={undo}><Undo2 className="size-5" /></BarButton>
            <button type="button" aria-label="Change putts" onClick={() => setPuttsOpen(true)} className="flex min-h-12 flex-1 items-center gap-2.5 px-2 text-left">
              <span className="grid size-10 place-items-center rounded-full border-2 border-white text-xl font-extrabold tabular-nums">{R.holeScore(hs)}</span>
              <span className="text-[13px] leading-tight"><b className="text-[15px]">{scoreName(R.holeScore(hs) - hole.par)}</b>
                <span className="block text-white/70">{hs.putts} {hs.putts === 1 ? 'putt' : 'putts'}</span></span>
            </button>
            <Button className="h-12 rounded-full pr-4 pl-5 text-[15px] font-extrabold" aria-label={last ? 'Finish round' : 'Go to the next hole'}
              onClick={() => (last ? setFinishing(true) : step(1))}>{last ? <>Finish <Flag /></> : <>Hole {nextNo} <ChevronRight /></>}</Button>
          </>) : nearGreen ? (<>
            <span className="pl-3 text-xs font-bold tracking-wider text-white/75">PUTTS</span>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => <button key={n} type="button" aria-label={`${n} ${n === 1 ? 'putt' : 'putts'}`} onClick={() => finishHole(n)}
                className="grid size-12 place-items-center rounded-full bg-white text-lg font-extrabold text-[#17251c]">{n}</button>)}
              <button type="button" aria-label={`Start shot · ${clubName ?? '–'}`} disabled={!club} onClick={() => mark()}
                className="grid size-12 place-items-center rounded-full border border-white/40 text-[11px] font-bold disabled:opacity-40">Shot</button>
            </div>
          </>) : (<>
            <BarButton aria-label="Previous hole" onClick={() => step(-1)}>‹ {prevNo}</BarButton>
            <button type="button" aria-label={`Change club (${clubName ?? 'none'})`} onClick={() => setClubs(true)}
              className={cn('grid size-[52px] place-content-center rounded-full bg-white leading-none text-[#17251c]', sug && club === sug.club.id && 'ring-2 ring-orange')}>
              <b className="text-[15px]">{clubShort ?? 'Club'}</b>{clubYds && <span className="text-[10px] text-[#5b6b60] tabular-nums">{clubYds}</span>}
            </button>
            <button type="button" aria-describedby="shot-feedback" onClick={() => mark()} disabled={!club || !live}
              aria-label={correction ? `Save correction · ${club === PUTTER ? 'Putt' : clubName ?? '–'}` : `Start shot · ${clubName ?? '–'}`}
              className="-mt-8 grid size-[76px] place-content-center rounded-full border-4 border-[rgb(12_14_13)] bg-primary leading-none font-extrabold text-primary-foreground shadow-lg disabled:opacity-60">
              <span className="text-base">{correction ? 'Save' : 'Shot'}</span><span className="mt-1 text-[10px] font-semibold opacity-85">#{R.holeScore(hs) + 1}</span>
            </button>
            <button type="button" aria-label="Putts (finishes the hole)" onClick={() => setPuttsOpen(true)}
              className="grid size-[52px] place-items-center rounded-full bg-white text-[13px] font-bold text-[#17251c]">Putts</button>
            <BarButton aria-label="Next hole" onClick={() => step(1)}>{nextNo} ›</BarButton>
          </>)}
        </div>
      </div>

      <Drawer open={clubs} onOpenChange={setClubs}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Club</DrawerTitle><DrawerDescription>{sug ? `${sug.club.name} for ${yd(aim)}` : `${yd(aim)} y`}</DrawerDescription></DrawerHeader>
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
            <DrawerDescription>{R.holeScore(hs) - hs.putts} {R.holeScore(hs) - hs.putts === 1 ? 'stroke' : 'strokes'} to the green</DrawerDescription></DrawerHeader>
          <div className="flex justify-center gap-3 px-5">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-label={`${n} ${n === 1 ? 'putt' : 'putts'}`} onClick={() => finishHole(n)}
                className={cn('grid size-16 place-content-center rounded-full border bg-background text-2xl font-bold tabular-nums', n === 2 && 'border-primary ring-2 ring-primary')}>{n}</button>
            ))}
          </div>
          <Button variant="ghost" className="mx-5 mt-3 mb-5 min-h-11 rounded-full" onClick={() => finishHole(0)}>Holed out · no putts</Button>
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
              <p className="mb-2 text-sm text-muted-foreground">Mishits</p>
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
            <Button variant="ghost" className="h-12 w-full rounded-full" onClick={() => { setTools(false); leave(); }}>Leave the map (the round keeps going)</Button>
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
      <Scorecard course={course} round={round} open={card} onOpenChange={setCard}
        onPick={(n) => { setCard(false); save({ ...round, current: n, updatedAt: new Date().toISOString() }); }} />
      {reviewed && <HoleReview key={reviewed.number} hole={reviewed} state={round.holes[reviewed.number] ?? R.emptyHole()} bag={bag} onClose={() => setReviewHole(null)} />}
    </div>
  );
}

const GLASS = 'bg-background/90 shadow-md backdrop-blur';
// Dark glass over the satellite map (fixed colors: it sits on imagery, not the page theme).
const MAP_DARK = 'bg-[rgb(12_14_13/0.84)] backdrop-blur';

// A small yardage circle beside the green (front and back).
function Dist({ yards, label }: { yards: number | string; label: string }) {
  return (
    <div data-yards={label.toLowerCase()} className={cn('ml-2.5 grid size-[52px] place-content-center rounded-full text-center leading-none', MAP_DARK)}>
      <b className="text-lg tabular-nums">{yards}</b><span className="mt-0.5 text-[9px] tracking-wider text-white/75 uppercase">{label}</span>
    </div>
  );
}

// A plain button inside the dark bar (hole arrows, reopen).
function BarButton({ className, ...p }: React.ComponentProps<'button'>) {
  return <button type="button" className={cn('grid min-h-11 min-w-11 place-items-center rounded-full px-1 text-[13px] font-semibold text-white/75', className)} {...p} />;
}

const scoreName = (d: number) =>
  ['Albatross', 'Eagle', 'Birdie', 'Par', 'Bogey', 'Double bogey', 'Triple bogey'][d + 3] ?? (d > 0 ? `+${d}` : `${d}`);

// The round map button: glass over the map, solid in the card.
function Circle({ card = false, className, ...p }: React.ComponentProps<typeof Button> & { card?: boolean }) {
  return <Button variant={card ? 'secondary' : 'ghost'} size="icon" className={cn('shrink-0 rounded-full', card ? 'size-12' : cn('size-12', GLASS), className)} {...p} />;
}

// Up to three bunkers or water near your line to the pin, with yards to reach–carry each.
function hazardsAhead(hole: Hole, from: LngLat, pin: LngLat, shotYd: number) {
  const toPin = distM(from, pin);
  return (hole.features ?? []).flatMap((f) => {
    if (f.type === 'fairway' || pointInPolygon(from, f.polygon)) return [];
    const c = centroid(f.polygon);
    const { d, along } = nearestOnLine(c, [from, pin]);
    if (d > 40 || along < 20) return [];
    if (distM(c, pin) < 45) return []; // greenside: the yardages beside the pin already cover it
    const { front, back } = frontBack(from, c, f.polygon);
    if (front > toPin + 10) return []; // behind the green (along is capped at the pin, so check the reach)
    if (back * M_TO_YD < Math.max(60, shotYd / 2)) return []; // carried easily: not in play
    return [{ pos: c, type: f.type, front, text: `${yd(front * M_TO_YD)}–${yd(back * M_TO_YD)}` }];
  }).sort((a, b) => a.front - b.front).slice(0, 3);
}

// The steeper of the two tilts, short enough for the pill: "Back +2.4 ft".
function mainTilt(hole: Hole) {
  const e = hole.green.elevFt;
  if (e?.front == null || e.back == null || e.left == null || e.right == null) return null;
  const fb = e.back - e.front, lr = e.right - e.left;
  if (Math.max(Math.abs(fb), Math.abs(lr)) < 0.5) return 'Flat';
  return Math.abs(fb) >= Math.abs(lr) ? `${fb > 0 ? 'Back' : 'Front'} +${Math.abs(fb).toFixed(1)} ft` : `${lr > 0 ? 'Right' : 'Left'} +${Math.abs(lr).toFixed(1)} ft`;
}
