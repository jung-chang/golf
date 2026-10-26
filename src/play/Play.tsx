import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, CloudOff, Crosshair, Flag, Map as MapIcon } from 'lucide-react';
import { toast } from 'sonner';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Empty } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { go } from '../lib/nav';
import { clubStats, PUTTER, shortName, shotYards, suggestClub } from '../lib/clubs';
import { getCourse } from '../lib/courses';
import { distYd, frontBack, midpoint, M_TO_YD, type LngLat } from '../lib/geo';
import * as R from '../lib/round';
import * as T from '../lib/tracking';
import { getState, saveRound, setActive, sync, useStore } from '../lib/store';
import type { HoleState, Round } from '../schemas/round';
import { HoleMap } from './HoleMap';
import { MapBoundary } from './MapBoundary';
import { HoleEditor } from './HoleEditor';
import { ClubPicker } from './ClubPicker';
import { Scorecard } from './Scorecard';
import { useGeolocation, useWakeLock } from './useGeolocation';

const DARK = 'bg-[rgb(12_14_13/0.88)] backdrop-blur text-white shadow-lg';
type Edit = { no: number; shot?: string; draft?: HoleState; split?: boolean; putts?: boolean };

export function Play({ roundId }: { roundId: string }) {
  const round = useStore(s => s.rounds[roundId]);
  const bag = useStore(s => s.bag), rounds = useStore(s => s.rounds);
  const syncStatus = useStore(s => s.syncStatus), saveError = useStore(s => s.saveError);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);
  const course = getCourse(round?.courseId ?? '');
  const geo = useGeolocation(); useWakeLock();
  const [picked, setPicked] = useState<string | null>(null), [clubs, setClubs] = useState(false);
  const [editor, setEditor] = useState<Edit | null>(null), [card, setCard] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [view, setView] = useState<'hole' | 'green'>('hole'), [recenter, setRecenter] = useState(0);
  const [target, setTarget] = useState<LngLat | null>(null);
  const bar = useRef<HTMLDivElement>(null), lastTap = useRef(0), [barH, setBarH] = useState(90);
  const hole = course?.holes.find(h => h.number === round?.current);
  const hs = round?.holes[round.current] ?? R.emptyHole();
  const pending = hs.pendingShot;
  const fix = geo.fix;
  const live = !!(hole && T.validFix(fix, Date.now(), 25) && distYd(fix.pos, hole.green.center) < 650);
  const recording = live && T.validFix(fix) ? fix : null;
  const tee = hole?.tees?.[round?.teeId]?.pos ?? hole?.path?.[0] ?? hole?.green.center ?? [0, 0];
  const from: LngLat = live && fix ? fix.pos : tee;
  const pin = hs.pin ?? hole?.green.center ?? [0, 0];
  const dPin = distYd(from, pin);
  const suggested = suggestClub(target ? distYd(from, target) : dPin, bag, stats);
  const club = pending?.club ?? picked ?? suggested?.club.id ?? bag.clubs.find(c => c.on && c.id !== PUTTER)?.id ?? null;
  const clubName = (id: string) => bag.clubs.find(c => c.id === id)?.name ?? id;
  const gap = round && hole && !round.done ? T.recoveryGap(hs, hole, round.teeId, recording, bag, geo.settledMs ?? 0) : null;
  const fb = hole?.green.polygon && live && dPin > 15 ? frontBack(from, pin, hole.green.polygon) : null;
  const nums = course?.holes.map(h => h.number) ?? [];
  const index = nums.indexOf(round?.current), previous = nums[(index - 1 + nums.length) % nums.length], next = nums[(index + 1) % nums.length];

  useEffect(() => { setPicked(null); setTarget(null); setClubs(false); setView('hole'); }, [round?.current]);
  useEffect(() => {
    if (!bar.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (bar.current) setBarH(Math.ceil(bar.current.getBoundingClientRect().height) + 25); });
    observer.observe(bar.current); return () => observer.disconnect();
  }, [!!course, editor]);

  if (!round || !course || !hole) return <Empty icon={<Flag />} title="This course isn't installed" action={<Button onClick={() => go('golf')}>Back to My golf</Button>}>Open an installed course to play this round.</Empty>;
  const latest = (): Round => {
    const r = getState().rounds[roundId];
    if (!r) throw new Error('This round is no longer available.');
    return r;
  };
  const run = (fn: () => void) => { try { fn(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to save this change.'); } };
  const save = (r: Round) => { if (r !== latest()) saveRound(r); };
  const allowTap = () => { const now = Date.now(); if (now - lastTap.current < 800) return false; lastTap.current = now; return true; };
  const selected = (id: string) => {
    if (id === 'suggestion' && gap) {
      const r = T.addRecoveredShot(latest(), gap, hole);
      if (r === latest()) return;
      const draft = r.holes[hole.number]; setEditor({ no: hole.number, shot: draft.shots.at(-1)!.id, draft, split: gap.mayBeMultiple });
    } else setEditor({ no: hole.number, shot: id });
  };
  const start = () => run(() => { if (!club || !allowTap()) return; save(T.startTrackedShot(latest(), club, recording)); setTarget(null); });
  const finishShot = () => run(() => { if (!allowTap()) return; save(T.saveTrackedShot(latest(), recording, pending?.id)); setPicked(null); setTarget(null); });
  const step = (d: number) => run(() => { const r = latest(); save({ ...r, current: nums[(nums.indexOf(r.current) + d + nums.length) % nums.length], updatedAt: new Date().toISOString() }); });
  const finishRound = () => run(() => {
    const r = latest(), open = Object.entries(r.holes).find(([, h]) => h.pendingShot);
    if (open) { setFinishing(false); save({ ...r, current: Number(open[0]), updatedAt: new Date().toISOString() }); throw new Error(`Save or cancel the tracked shot on hole ${open[0]} first.`); }
    save({ ...r, done: true, updatedAt: new Date().toISOString() }); setActive(null); go(`golf/round/${r.id}`);
  });

  if (editor) {
    const edit = course.holes.find(h => h.number === editor.no)!;
    return <HoleEditor key={`${editor.no}-${editor.shot ?? 'whole'}`} hole={edit} state={round.holes[editor.no] ?? R.emptyHole()}
      bag={bag} teeId={round.teeId} activeHole={round.current} here={editor.no === round.current ? recording : null} initialShot={editor.shot} initialDraft={editor.draft} initialSplit={editor.split}
      onClose={() => setEditor(null)} onSave={(expected, draft) => { save(T.commitHoleEdit(latest(), edit.number, expected, draft)); lastTap.current = Date.now(); setEditor(null); }}
      onFinish={editor.putts && !round.holes[edit.number]?.completed && editor.no === round.current ? (expected, draft) => {
        const r = T.commitHoleEdit(latest(), edit.number, expected, draft);
        let updated = T.completeTrackedHole(r, draft.putts, edit.number);
        if (index < nums.length - 1) updated = { ...updated, current: next };
        save(updated); lastTap.current = Date.now(); setEditor(null); setView('hole');
        if (index === nums.length - 1) setFinishing(true);
      } : undefined}
      onCancelTracking={round.holes[edit.number]?.pendingShot && edit.number === round.current ? () => { save(T.cancelTrackedShot(latest())); setEditor(null); } : undefined} />;
  }
  const features = hs.shots.flatMap((s, i) => s.pos && s.end ? [{ id: T.shotId(s, i, hole.number), start: s.pos, end: s.end }] : []);
  if (gap?.start) features.push({ id: 'suggestion', start: gap.start, end: gap.finish.pos });
  const mapFeatures = features.map(s => ({ ...s, suggested: s.id === 'suggestion' }));
  if (pending?.pos && recording) mapFeatures.push({ id: 'pending', start: pending.pos, end: recording.pos, suggested: false });
  const lines: [LngLat, LngLat][] = mapFeatures.map(s => [s.start, s.end]);
  const shotTags: { pos: LngLat; text: string; shotId: string; actionLabel?: string }[] = hs.shots.flatMap((s, i) => s.pos || s.end ? [{ pos: s.pos && s.end ? midpoint(s.pos, s.end) : (s.pos ?? s.end)!,
    text: `Shot ${i + 1} · ${shortName(clubName(s.club))}${shotYards(s) != null ? ` ${Math.round(shotYards(s)!)}y` : ''}`, shotId: T.shotId(s, i, hole.number) }] : []);
  if (gap?.start) shotTags.push({ pos: midpoint(gap.start, gap.finish.pos), shotId: 'suggestion',
    text: gap.mayBeMultiple ? `Missing shots? · ${gap.yards} yd` : `Missed shot? ${shortName(clubName(gap.club))} · ${gap.yards} yd`,
    actionLabel: gap.mayBeMultiple ? `Review missing shots, ${gap.yards} yards` : `Edit missed ${clubName(gap.club)} shot, ${gap.yards} yards` });
  const focusPoints = gap?.start ? [gap.start, gap.finish.pos, ...(hole.green.polygon ?? [pin]), pin] : undefined;
  const trackedYards = pending?.pos && recording ? Math.round(distYd(pending.pos, recording.pos)) : null;
  const saved = saveError ? 'Not saved on this phone' : syncStatus === 'offline' ? 'Offline · saved on this phone' : syncStatus === 'error' ? 'Saved on this phone · will sync' : null;
  return <div className="play relative h-dvh overflow-hidden bg-[#1f3324] text-white">
    <div className="absolute inset-0"><MapBoundary><HoleMap hole={hole} from={hs.completed ? hs.shots.find(s => s.pos)?.pos ?? tee : from}
      here={live ? fix!.pos : null} hereAcc={fix?.acc} pin={pin} target={hs.completed ? null : target}
      view={hs.completed ? 'hole' : view} review={!!hs.completed} recenter={recenter} padBottom={barH} focusPoints={focusPoints}
      labels={[]} shotLines={lines} shotFeatures={mapFeatures} shotTags={shotTags}
      onSelectShot={id => { if (id !== 'pending') run(() => selected(id)); }} onTap={setTarget} onTargetMove={setTarget} onClearTarget={() => setTarget(null)}
      onPinMove={p => run(() => save(R.setPin(latest(), p)))}
      pinCallout={!hs.completed ? <div className="grid justify-items-start gap-1.5 text-white">
        {fb && <Yardage n={Math.round(fb.back * M_TO_YD)} label="Back" />}
        <Yardage n={Math.round(dPin)} label={live ? 'Center' : 'Tee view'} center />
        {fb && <Yardage n={Math.round(fb.front * M_TO_YD)} label="Front" />}
      </div> : undefined} /></MapBoundary></div>
    <nav aria-label="Hole navigation" className={cn('absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-3 flex items-stretch overflow-hidden rounded-[15px] border border-white/10', DARK)}>
      <button type="button" aria-label={`Previous hole, ${previous}`} className="grid min-h-11 w-11 place-items-center active:bg-white/15" onClick={() => step(-1)}><ChevronLeft className="size-4" /></button>
      <button type="button" aria-label={`Hole ${hole.number}, scorecard`} className="flex min-h-11 items-center gap-2.5 border-x border-white/10 px-2.5 text-left active:bg-white/15" onClick={() => setCard(true)}>
        <span className="text-xl leading-none font-medium tabular-nums">{hole.number}</span>
        <span className="text-[10px] font-medium text-white/70">Par {hole.par} · {hole.yards?.[round.teeId] ?? '–'} yd</span>
      </button>
      <button type="button" aria-label={`Next hole, ${next}`} className="grid min-h-11 w-11 place-items-center active:bg-white/15" onClick={() => step(1)}><ChevronRight className="size-4" /></button>
    </nav>
    <div className="absolute left-4 grid gap-2" style={{ bottom: `calc(env(safe-area-inset-bottom) + ${barH + 4}px)` }}><Circle label={view === 'green' ? 'Show the whole hole' : 'Zoom to the green'} onClick={() => setView(v => v === 'green' ? 'hole' : 'green')}>{view === 'green' ? <MapIcon /> : <Flag />}</Circle><Circle label="Recenter" onClick={() => { setTarget(null); setRecenter(n => n + 1); }}><Crosshair /></Circle></div>
    <div ref={bar} className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] mx-auto max-w-lg">
      <div className={cn('overflow-hidden rounded-[20px] p-2', DARK)}>
      {saved && <p role="status" aria-label="Saving" className={cn('mb-1 flex min-h-7 items-center justify-center gap-2 text-[10px]', saveError ? 'text-[#ffc5ad]' : 'text-white/65')}><CloudOff className="size-3" />{saved}{saveError && <button type="button" className="min-h-11 px-2 font-semibold underline" onClick={() => void sync()}>Retry</button>}</p>}
      {!live && <p role="status" aria-label="Location" className="mb-1 text-center text-[10px] text-white/55">{geo.error ? 'Location off · tee yardages' : 'Waiting for GPS · tee yardages'}</p>}
      <div data-tracking-bar className="flex items-center gap-2">
        {hs.completed ? <>
          <button type="button" className="min-h-12 flex-1 rounded-xl px-3 text-sm" onClick={() => setEditor({ no: hole.number })}>Edit hole · {R.holeScore(hs)} strokes</button>
          <button type="button" className="min-h-12 flex-1 rounded-xl bg-[#d9e8cd] px-3 text-sm font-semibold text-[#213d2b]" onClick={() => index === nums.length - 1 ? setFinishing(true) : step(1)}>{index === nums.length - 1 ? 'Finish round' : `Hole ${next} ›`}</button>
        </> : <>
          <button type="button" aria-label={`Choose club, currently ${club ? clubName(club) : 'none'}`} aria-expanded={clubs} className="flex min-h-12 min-w-0 shrink-0 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-sm font-medium" onClick={() => setClubs(true)}>
            <span className="max-w-20 truncate">{club ? shortName(clubName(club)) : 'Club'}</span><ChevronDown className="size-3.5 text-white/50" />
          </button>
          <button type="button" disabled={!club} aria-label={pending ? `Save here · Tracking ${clubName(pending.club)} shot${trackedYards != null ? ` · ${trackedYards} yards` : ''}` : `Start shot · ${club ? clubName(club) : 'choose club'}`}
            onClick={pending ? finishShot : start} className={cn('min-h-12 min-w-0 flex-1 rounded-xl px-3 text-sm font-semibold whitespace-nowrap disabled:opacity-40', pending ? 'bg-[#efb352] text-[#241c0f]' : 'bg-[#d9e8cd] text-[#213d2b]')}>
            {pending ? `Save here${trackedYards != null ? ` · ${trackedYards} yd` : ''}` : 'Track shot'}
          </button>
        </>}
      </div>
      </div>
    </div>
    <ClubPicker bag={bag} selected={club} open={clubs} includePutter onClose={() => setClubs(false)} onPick={id => run(() => {
      if (id === PUTTER) {
        if (latest().holes[hole.number]?.pendingShot) { toast.error('Save the tracked shot before entering putts.'); return; }
        setClubs(false); setEditor({ no: hole.number, putts: true }); return;
      }
      setPicked(id); setClubs(false); if (pending) save(T.changeTrackedClub(latest(), id));
    })} />
    <Drawer open={finishing} onOpenChange={setFinishing}><DrawerContent><DrawerHeader><DrawerTitle>Finish the round?</DrawerTitle><DrawerDescription>{R.totalScore(round)} ({R.fmtToPar(R.toPar(round))}) over {R.playedHoles(round).length} holes at {round.courseName}.</DrawerDescription></DrawerHeader><DrawerFooter><Button onClick={finishRound} className="min-h-12 rounded-full">Finish round</Button><Button variant="ghost" onClick={() => setFinishing(false)}>Keep playing</Button></DrawerFooter></DrawerContent></Drawer>
    <Scorecard course={course} round={round} open={card} onOpenChange={setCard} onPick={no => { setCard(false); const h = round.holes[no]; if (h && (R.holeScore(h) || h.pendingShot)) setEditor({ no }); else run(() => save({ ...latest(), current: no, updatedAt: new Date().toISOString() })); }}>
      <div className="grid gap-2 border-t px-5 py-4"><Button variant="outline" className="min-h-11" onClick={() => { setCard(false); setEditor({ no: hole.number }); }}>Edit hole {hole.number}</Button>
        <div className="flex gap-2"><Button variant="ghost" className="min-h-11 flex-1" onClick={() => { setCard(false); setFinishing(true); }}>End round</Button><Button variant="ghost" className="min-h-11 flex-1" onClick={() => go(round.gameId ? `games/${round.gameId}` : 'golf')}>Leave map</Button></div></div>
    </Scorecard>
  </div>;
}
function Circle({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className={cn('grid size-11 shrink-0 place-items-center rounded-full', DARK)}>{children}</button>;
}
function Yardage({ n, label, center = false }: { n: number; label: string; center?: boolean }) {
  return <div data-yards={label.toLowerCase()} className={cn('grid place-content-center rounded-full text-center leading-none', DARK, center ? '-ml-2 size-[72px] border-2 border-white' : 'size-[52px]')}><b className={center ? 'text-[26px]' : 'text-lg'}>{n}</b><span className="mt-1 text-[9px] text-white/75 uppercase">{label}</span></div>;
}
