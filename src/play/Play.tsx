import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, Crosshair, Flag, Map as MapIcon, MoreHorizontal, X } from 'lucide-react';
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

const SIM = new URLSearchParams(location.search).has('sim');
const DARK = 'bg-[rgb(12_14_13/0.88)] backdrop-blur text-white shadow-lg';
type Edit = { no: number; shot?: string; draft?: HoleState };

export function Play({ roundId }: { roundId: string }) {
  const round = useStore(s => s.rounds[roundId]);
  const bag = useStore(s => s.bag), rounds = useStore(s => s.rounds);
  const syncStatus = useStore(s => s.syncStatus), saveError = useStore(s => s.saveError);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);
  const course = getCourse(round?.courseId ?? '');
  const geo = useGeolocation(); useWakeLock();
  const [picked, setPicked] = useState<string | null>(null), [clubs, setClubs] = useState(false);
  const [editor, setEditor] = useState<Edit | null>(null), [card, setCard] = useState(false), [tools, setTools] = useState(false);
  const [finishing, setFinishing] = useState(false), [puttsOpen, setPuttsOpen] = useState(false);
  const [putts, setPutts] = useState('2'), [puttContext, setPuttContext] = useState('');
  const [view, setView] = useState<'hole' | 'green'>('hole'), [recenter, setRecenter] = useState(0);
  const [target, setTarget] = useState<LngLat | null>(null), [lastAdded, setLastAdded] = useState<string | null>(null);
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
  const proposal = round && hole && !round.done && !puttsOpen ? T.suggestRecovery(hs, hole, round.teeId, recording, bag, geo.settledMs ?? 0) : null;
  const source = hole && round ? T.recoveryStart(hs, hole, round.teeId) : null;
  const canManual = !pending && !hs.completed && !puttsOpen && !proposal;
  const fb = hole?.green.polygon && live ? frontBack(from, pin, hole.green.polygon) : null;
  const nums = course?.holes.map(h => h.number) ?? [];
  const index = nums.indexOf(round?.current), previous = nums[(index - 1 + nums.length) % nums.length], next = nums[(index + 1) % nums.length];
  const finished = round ? R.playedHoles(round).filter(([n, h]) => h.completed || Number(n) !== round.current) : [];
  const toPar = finished.reduce((sum, [n, h]) => sum + R.holeScore(h) - (round.pars[n] ?? 4), 0);
  const previousCompleted = course?.holes.filter(h => h.number !== round.current && round.holes[h.number]?.completed).at(-1);

  useEffect(() => { setPicked(null); setTarget(null); setClubs(false); setPuttsOpen(false); setView('hole'); setLastAdded(null); lastTap.current = 0; }, [round?.current]);
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
    if (puttsOpen) return;
    if (id === 'suggestion' && proposal) {
      const r = T.addRecoveredShot(latest(), proposal, hole);
      if (r === latest()) return;
      const draft = r.holes[hole.number]; setEditor({ no: hole.number, shot: draft.shots.at(-1)!.id, draft });
    } else setEditor({ no: hole.number, shot: id });
  };
  const manual = () => {
    const h = latest().holes[hole.number] ?? R.emptyHole();
    const draft = T.insertEditedShot(h, hole.number, h.shots.length, club ?? 'dr');
    draft.shots.at(-1)!.pos = T.recoveryStart(h, hole, round.teeId).start;
    draft.shots.at(-1)!.end = recording?.pos ?? null;
    setEditor({ no: hole.number, shot: draft.shots.at(-1)!.id, draft });
  };
  const start = () => run(() => { if (!club || !allowTap()) return; save(T.startTrackedShot(latest(), club, recording)); setLastAdded(null); setTarget(null); });
  const finishShot = () => run(() => { if (!allowTap()) return; const r = T.saveTrackedShot(latest(), recording, pending?.id); save(r); setPicked(null); setTarget(null); setLastAdded(r.holes[hole.number]?.shots.at(-1)?.id ?? null); });
  const addSuggestion = () => run(() => {
    if (!allowTap()) return;
    const r = latest(), suggestion = T.suggestRecovery(r.holes[hole.number] ?? R.emptyHole(), hole, r.teeId, recording, getState().bag, geo.settledMs ?? 0);
    if (!suggestion) return;
    const updated = T.addRecoveredShot(r, suggestion, hole);
    if (updated !== r) { save(updated); setLastAdded(updated.holes[hole.number].shots.at(-1)!.id!); setPicked(null); }
  });
  const openPutts = (saveFirst = false) => run(() => {
    let r = latest();
    setPuttContext('');
    if (saveFirst && r.holes[hole.number]?.pendingShot) {
      if (!allowTap()) return;
      r = T.saveTrackedShot(r, recording, pending?.id); save(r);
      const s = r.holes[hole.number].shots.at(-1)!;
      setPuttContext(`${shortName(clubName(s.club))} shot saved${shotYards(s) != null ? ` · ${Math.round(shotYards(s)!)} y` : ' · finish not recorded'}`);
    }
    if (r.holes[hole.number]?.pendingShot) return;
    const h = r.holes[hole.number]; setPutts(String(h?.completed ? h.putts : h?.putts || 2));
    setClubs(false); setPuttsOpen(true); setView('green'); setLastAdded(null);
  });
  const finishHole = () => run(() => {
    const n = Number(putts); if (!putts.trim() || !Number.isSafeInteger(n) || n < 0 || n > 999) throw new Error('Enter a whole putt count from 0 to 999.');
    if (!allowTap()) return;
    const r = latest(), editing = !!r.holes[hole.number]?.completed;
    let updated = T.completeTrackedHole(r, n, hole.number);
    if (!editing && r.current === hole.number && index < nums.length - 1) updated = { ...updated, current: next };
    save(updated); setPuttsOpen(false); setView('hole');
    if (!editing && index === nums.length - 1) setFinishing(true);
  });
  const step = (d: number) => run(() => { const r = latest(); setPuttsOpen(false); save({ ...r, current: nums[(nums.indexOf(r.current) + d + nums.length) % nums.length], updatedAt: new Date().toISOString() }); });
  const finishRound = () => run(() => {
    const r = latest(), open = Object.entries(r.holes).find(([, h]) => h.pendingShot);
    if (open) { setFinishing(false); save({ ...r, current: Number(open[0]), updatedAt: new Date().toISOString() }); throw new Error(`Save or cancel the tracked shot on hole ${open[0]} first.`); }
    save({ ...r, done: true, updatedAt: new Date().toISOString() }); setActive(null); go(`golf/round/${r.id}`);
  });

  if (editor) {
    const edit = course.holes.find(h => h.number === editor.no)!;
    return <HoleEditor key={`${editor.no}-${editor.shot ?? 'whole'}`} hole={edit} state={round.holes[editor.no] ?? R.emptyHole()}
      bag={bag} teeId={round.teeId} activeHole={round.current} initialShot={editor.shot} initialDraft={editor.draft}
      onClose={() => setEditor(null)} onSave={(expected, draft) => { save(T.commitHoleEdit(latest(), edit.number, expected, draft)); setEditor(null); }} />;
  }
  const features = hs.shots.flatMap((s, i) => s.pos && s.end ? [{ id: T.shotId(s, i, hole.number), start: s.pos, end: s.end }] : []);
  if (proposal?.start) features.push({ id: 'suggestion', start: proposal.start, end: proposal.finish.pos });
  const mapFeatures = features.map(s => ({ ...s, suggested: s.id === 'suggestion' }));
  if (pending?.pos && recording) mapFeatures.push({ id: 'pending', start: pending.pos, end: recording.pos, suggested: false });
  const lines: [LngLat, LngLat][] = mapFeatures.map(s => [s.start, s.end]);
  const shotTags = hs.shots.flatMap((s, i) => s.pos || s.end ? [{ pos: s.pos && s.end ? midpoint(s.pos, s.end) : (s.pos ?? s.end)!,
    text: `Shot ${i + 1} · ${shortName(clubName(s.club))}${shotYards(s) != null ? ` ${Math.round(shotYards(s)!)}y` : ''}`, shotId: T.shotId(s, i, hole.number) }] : []);
  const missing = hs.shots.findIndex(s => !s.pos && !s.end);
  const nPutts = Number(putts), validPutts = !!putts.trim() && Number.isSafeInteger(nPutts) && nPutts >= 0 && nPutts <= 999;
  const focusPoints = puttsOpen ? [...(hole.green.polygon ?? [pin]), from] : undefined;
  const saved = saveError ? 'Not saved on this phone' : syncStatus === 'offline' ? 'Offline · saved on this phone' : syncStatus === 'error' ? 'Saved on this phone · will sync' : null;
  return <div className="play relative h-dvh overflow-hidden bg-[#1f3324] text-white">
    <div className="absolute inset-0"><MapBoundary><HoleMap hole={hole} from={hs.completed ? hs.shots.find(s => s.pos)?.pos ?? tee : from}
      here={live && !puttsOpen ? fix!.pos : null} hereAcc={fix?.acc} pin={pin} target={puttsOpen || hs.completed ? null : target}
      view={hs.completed ? 'hole' : view} review={!!hs.completed || puttsOpen} recenter={recenter} padBottom={barH} focusPoints={focusPoints}
      labels={[]} shotLines={lines} shotFeatures={mapFeatures} shotTags={puttsOpen ? [] : shotTags}
      onSelectShot={id => { if (id !== 'pending') selected(id); }} onTap={setTarget} onTargetMove={setTarget} onClearTarget={() => setTarget(null)}
      onPinMove={p => run(() => save(R.setPin(latest(), p)))} onLongPress={SIM ? p => geo.inject(p, 3) : undefined}
      pinCallout={!puttsOpen && !hs.completed ? <div className="grid justify-items-start gap-1.5 text-white">
        {fb && <Yardage n={Math.round(fb.back * M_TO_YD)} label="Back" />}
        <Yardage n={Math.round(dPin)} label={live ? 'Center' : 'Tee view'} center />
        {fb && <Yardage n={Math.round(fb.front * M_TO_YD)} label="Front" />}
      </div> : undefined} /></MapBoundary></div>
    <div className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 left-3 flex items-center justify-between gap-2">
      <div className={cn('flex items-center rounded-2xl', DARK)}>
        <button type="button" aria-label="Previous hole" className="min-h-14 min-w-11 px-1 text-xs" onClick={() => step(-1)}>‹ {previous}</button>
        <button type="button" aria-label={`Hole ${hole.number}${finished.length ? `, ${R.fmtToPar(toPar)} thru ${finished.length}` : ''}, scorecard`} className="flex min-h-14 items-center gap-2 text-left" onClick={() => setCard(true)}>
          <b className="text-3xl">{hole.number}</b><span className="text-[10px] leading-snug text-white/75">Par {hole.par} · {hole.yards?.[round.teeId] ?? '–'} y<br /><b className="text-white">{finished.length ? `${R.fmtToPar(toPar)} thru ${finished.length}` : `${round.teeName} tees`}</b></span>
        </button><button type="button" aria-label="Next hole" className="min-h-14 min-w-11 px-1 text-xs" onClick={() => step(1)}>{next} ›</button>
      </div><Circle label="Hole tools and penalties" onClick={() => setTools(true)}><MoreHorizontal /></Circle>
    </div>
    <div className="absolute top-[calc(env(safe-area-inset-top)+4.75rem)] left-3 grid max-w-[calc(100%-1.5rem)] gap-1">
      {!live && <p role="status" aria-label="Location" className={cn('rounded-full px-3 py-2 text-[11px]', DARK)}>{SIM ? 'Sim: long-press to set your position' : geo.error ? 'Location is off · yardages from the tee' : 'No fresh course GPS · yardages from the tee'}</p>}
      {saved && <p role="status" aria-label="Saving" className={cn('flex items-center gap-2 rounded-full px-3 py-1 text-[11px]', saveError ? 'bg-destructive' : DARK)}><CloudOff className="size-3" />{saved}{saveError && <button type="button" className="min-h-9 px-2 font-bold" onClick={() => void sync()}>Retry</button>}</p>}
    </div>
    {!puttsOpen && <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] left-4 grid gap-2"><Circle label={view === 'green' ? 'Show the whole hole' : 'Zoom to the green'} onClick={() => setView(v => v === 'green' ? 'hole' : 'green')}>{view === 'green' ? <MapIcon /> : <Flag />}</Circle><Circle label="Recenter" onClick={() => { setTarget(null); setRecenter(n => n + 1); }}><Crosshair /></Circle></div>}
    <div ref={bar} className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] mx-auto max-w-lg space-y-2">
      <div role="status" aria-label="Shot guidance" className="flex justify-center text-[11px]">
        {pending ? <span className={cn('flex items-center rounded-full pl-3', DARK)}>{pending.pos && recording ? `${Math.round(distYd(pending.pos, recording.pos))} y so far` : 'Location missing · edit later'}<button type="button" aria-label="Cancel tracking" className="grid size-11 place-items-center" onClick={() => run(() => save(T.cancelTrackedShot(latest())))}><X className="size-4" /></button></span>
          : lastAdded ? <button type="button" className={cn('min-h-11 rounded-full px-4', DARK)} onClick={() => selected(lastAdded)}>Shot added · Edit ↗</button>
          : missing >= 0 ? <button type="button" className={cn('min-h-11 rounded-full px-4', DARK)} onClick={() => selected(T.shotId(hs.shots[missing], missing, hole.number))}>Edit unplaced shot</button> : null}
      </div>
      {clubs && <ClubPicker bag={bag} selected={club} onPick={id => run(() => { setPicked(id); setClubs(false); if (pending) save(T.changeTrackedClub(latest(), id)); })} />}
      {canManual && (!recording || source?.source === 'unknown') && <button type="button" onClick={manual} className={cn('mx-auto block min-h-11 rounded-full px-4 text-xs', DARK)}>+ Add shot manually</button>}
      {canManual && recording && source?.start && distYd(source.start, recording.pos) > 3 && <button type="button" onClick={manual} className={cn('mx-auto block min-h-11 rounded-full px-4 text-xs', DARK)}>+ Add short shot</button>}
      {puttsOpen ? <div className={cn('rounded-3xl p-4', DARK)}>
        <div className="flex items-center justify-between"><b>Putts</b><button type="button" aria-label="Back to shots" className="grid size-11 place-items-center" onClick={() => setPuttsOpen(false)}><X className="size-5" /></button></div>
        {puttContext && <p className="text-center text-xs text-[#b7d9a6]">{puttContext}</p>}
        <div className="my-3 flex items-center justify-center gap-5"><button type="button" aria-label="One fewer putt" className="size-11 rounded-full bg-white text-xl text-[#17251c]" onClick={() => setPutts(String(Math.max(0, (validPutts ? nPutts : 0) - 1)))}>−</button>
          <input aria-label="Putt count" type="number" min="0" max="999" step="1" value={putts} onChange={e => setPutts(e.target.value)} className="h-12 w-20 bg-transparent text-center text-3xl" />
          <button type="button" aria-label="One more putt" className="size-11 rounded-full bg-white text-xl text-[#17251c]" onClick={() => setPutts(String(Math.min(999, (validPutts ? nPutts : 0) + 1)))}>+</button></div>
        <button type="button" disabled={!validPutts} onClick={finishHole} className="min-h-12 w-full rounded-full bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40">{hs.completed ? 'Save putts' : 'Finish hole'} · {validPutts ? hs.shots.length + nPutts + hs.penalties + hs.adj : '–'} strokes</button>
      </div> : <div className={cn('flex min-h-16 items-center gap-1.5 rounded-full p-2', DARK)}>
        {hs.completed ? <><button type="button" className="min-h-12 flex-1 text-sm" onClick={() => setEditor({ no: hole.number })}><b>{R.holeScore(hs)} strokes</b><span className="block text-[10px] text-white/65">{hs.putts} putts · Edit hole</span></button><button type="button" className="min-h-12 rounded-full bg-primary px-5 text-sm font-bold" onClick={() => openPutts()}>Putts</button><button type="button" className="min-h-12 rounded-full bg-white px-4 text-sm font-bold text-[#17251c]" onClick={() => index === nums.length - 1 ? setFinishing(true) : step(1)}>{index === nums.length - 1 ? 'Finish' : `Hole ${next} ›`}</button></>
          : <><button type="button" aria-label={`Choose club, currently ${club ? clubName(club) : 'none'}`} aria-expanded={clubs} className="grid size-11 shrink-0 place-content-center rounded-full bg-white text-[#17251c]" onClick={() => setClubs(v => !v)}><b className="text-xs">{club ? shortName(clubName(club)) : 'Club'}</b><span className="text-[9px]">Club⌄</span></button>
            {proposal && <button type="button" aria-label={`Add missed ${clubName(proposal.club)} shot, ${proposal.yards} yards, from ${proposal.source === 'tee' ? `${round.teeName} tee` : 'last saved finish'}`}
              onClick={addSuggestion} className="grid min-h-12 min-w-0 flex-1 place-content-center rounded-full border border-orange/60 bg-orange/10 px-1 text-orange"><span className="text-[8px]">Missed shot?</span><b className="text-[11px]">+ {shortName(clubName(proposal.club))} · {proposal.yards}y</b><span className="text-[8px] opacity-75">{proposal.source === 'tee' ? `${round.teeName} tee` : 'Last finish'}</span></button>}
            <button type="button" disabled={!club} aria-label={pending ? `Save here · Tracking ${clubName(pending.club)} shot` : `Start shot · ${club ? clubName(club) : 'choose club'}`}
              onClick={pending ? finishShot : start} className={cn('grid min-h-12 min-w-0 flex-1 place-content-center rounded-full px-2 leading-tight font-bold disabled:opacity-40', pending ? 'bg-orange text-orange-foreground' : 'bg-primary text-primary-foreground')}><span className={proposal ? 'text-xs' : 'text-sm'}>{pending ? 'Save here' : 'Track shot'}</span><span className="mt-1 max-w-full truncate text-[9px] font-medium">{pending ? `Tracking ${clubName(pending.club)} shot` : `${club ? clubName(club) : 'Choose club'} · #${hs.shots.length + 1}`}</span></button>
            <button type="button" aria-label={pending ? `Save ${clubName(pending.club)} shot here and enter putts` : 'Putts'} onClick={() => openPutts(!!pending)} className="grid size-11 shrink-0 place-content-center rounded-full bg-white text-[10px] leading-tight font-bold text-[#17251c]">{pending ? <>Save +<br />putts</> : 'Putts'}</button></>}
      </div>}
    </div>
    <Drawer open={tools} onOpenChange={setTools}><DrawerContent><DrawerHeader><DrawerTitle>Hole {hole.number} · Par {hole.par}</DrawerTitle><DrawerDescription>{R.holeScore(hs)} strokes · {hs.penalties} penalties</DrawerDescription></DrawerHeader>
      <div className="space-y-2 px-5 pb-5"><Button className="min-h-12 w-full rounded-full" onClick={() => { setTools(false); setEditor({ no: hole.number }); }}>Edit hole · map & shots</Button>
        <Button variant="outline" className="min-h-12 w-full rounded-full" onClick={() => run(() => save(R.penalty(latest())))}>Add a penalty stroke</Button>
        <div className="flex items-center justify-between"><Button variant="outline" aria-label="Score minus one" disabled={R.holeScore(hs) <= 0} onClick={() => run(() => save(R.adjust(latest(), -1)))}>−</Button><span className="text-sm">Score adjustment {hs.adj > 0 ? '+' : ''}{hs.adj}</span><Button variant="outline" aria-label="Score plus one" onClick={() => run(() => save(R.adjust(latest(), 1)))}>+</Button></div>
        {previousCompleted && <Button variant="secondary" className="min-h-12 w-full" onClick={() => { setTools(false); setEditor({ no: previousCompleted.number }); }}>Edit hole {previousCompleted.number} · shots & yardages</Button>}
        <Button variant="outline" className="min-h-12 w-full" onClick={() => { setTools(false); setFinishing(true); }}>End round</Button><Button variant="ghost" className="min-h-12 w-full" onClick={() => go(round.gameId ? `games/${round.gameId}` : 'golf')}>Leave the map (round keeps going)</Button></div></DrawerContent></Drawer>
    <Drawer open={finishing} onOpenChange={setFinishing}><DrawerContent><DrawerHeader><DrawerTitle>Finish the round?</DrawerTitle><DrawerDescription>{R.totalScore(round)} ({R.fmtToPar(R.toPar(round))}) over {R.playedHoles(round).length} holes at {round.courseName}.</DrawerDescription></DrawerHeader><DrawerFooter><Button onClick={finishRound} className="min-h-12 rounded-full">Finish round</Button><Button variant="ghost" onClick={() => setFinishing(false)}>Keep playing</Button></DrawerFooter></DrawerContent></Drawer>
    <Scorecard course={course} round={round} open={card} onOpenChange={setCard} onPick={no => { setCard(false); const h = round.holes[no]; if (h && (R.holeScore(h) || h.pendingShot)) setEditor({ no }); else run(() => save({ ...latest(), current: no, updatedAt: new Date().toISOString() })); }} />
  </div>;
}
function Circle({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className={cn('grid size-11 shrink-0 place-items-center rounded-full', DARK)}>{children}</button>;
}
function Yardage({ n, label, center = false }: { n: number; label: string; center?: boolean }) {
  return <div data-yards={label.toLowerCase()} className={cn('grid place-content-center rounded-full text-center leading-none', DARK, center ? '-ml-2 size-[72px] border-2 border-white' : 'size-[52px]')}><b className={center ? 'text-[26px]' : 'text-lg'}>{n}</b><span className="mt-1 text-[9px] text-white/75 uppercase">{label}</span></div>;
}
