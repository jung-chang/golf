import { useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import type { Bag, HoleState } from '../schemas/round';
import type { Hole } from '../schemas/course';
import { holeScore } from '../lib/round';
import { deleteEditedShot, insertEditedShot, prepareHole, shotId, splitEditedShot, stockClubFor, validFix, type ShotFix } from '../lib/tracking';
import { midpoint, type LngLat } from '../lib/geo';
import { shortName, shotYards } from '../lib/clubs';
import { HoleMap } from './HoleMap';
import { ClubPicker } from './ClubPicker';
import { MapBoundary } from './MapBoundary';

export function HoleEditor({ hole, state, bag, teeId, activeHole, here = null, initialShot, initialDraft, initialSplit = false, onClose, onSave }: {
  hole: Hole; state: HoleState; bag: Bag; teeId: string; activeHole?: number; initialShot?: string;
  here?: ShotFix | null;
  initialDraft?: HoleState; initialSplit?: boolean; onClose: () => void; onSave: (expected: HoleState, draft: HoleState) => void;
}) {
  const expected = useRef(structuredClone(state));
  const [draft, setDraft] = useState(() => prepareHole(initialDraft ?? state, hole.number));
  const [selected, setSelected] = useState<string | null>(initialShot ?? null);
  const [point, setPoint] = useState<'pos' | 'end'>('pos');
  const [clubs, setClubs] = useState(false), [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState(''), [recenter, setRecenter] = useState(0);
  const [replaceAdjustment, setReplaceAdjustment] = useState(false);
  const [splitting, setSplitting] = useState(initialSplit);
  const [stops, setStops] = useState<{ draft: HoleState; selected: string }[]>([]);
  const selectedShot = draft.shots.find(s => s.id === selected);
  const name = (club: string) => bag.clubs.find(c => c.id === club)?.name ?? club;
  const base = hole.tees?.[teeId]?.pos ?? hole.path?.[0] ?? hole.green.center;
  const pin = draft.pin ?? hole.green.center;
  const update = (fn: (h: HoleState) => void) => setDraft(h => { const n = structuredClone(h); fn(n); return n; });
  const choose = (id: string) => { setSelected(id); setPoint('pos'); setClubs(false); setSplitting(false); setDeleteConfirm(false); setRecenter(n => n + 1); };
  const move = (key: 'pos' | 'end', pos: LngLat) => {
    setSplitting(false); setPoint(key); update(h => {
      const s = h.shots.find(s => s.id === selected); if (!s) return;
      s[key] = pos; s.origin = 'manual';
      if (key === 'end') { s.endAcc = null; delete s.endT; h.log = h.log.filter(op => op !== 'holed'); }
    });
  };
  const add = () => {
    const index = selected ? draft.shots.findIndex(s => s.id === selected) + 1 : draft.shots.length;
    const n = insertEditedShot(draft, hole.number, index, selectedShot?.club ?? bag.clubs.find(c => c.on)?.id ?? 'dr');
    // Previous finish / next start are only draft suggestions, never rewrites of neighbors.
    n.shots[index].pos = n.shots[index - 1]?.end ?? (index === 0 ? hole.tees?.[teeId]?.pos ?? null : null);
    const fix = validFix(here) && !draft.completed ? here : null;
    n.shots[index].end = n.shots[index + 1]?.pos ?? fix?.pos ?? null;
    if (!n.shots[index + 1]?.pos && fix) { n.shots[index].endAcc = fix.acc; n.shots[index].endT = fix.t; }
    n.shots[index].club = stockClubFor(n.shots[index].pos, n.shots[index].end, bag) ?? n.shots[index].club;
    setDraft(n); choose(n.shots[index].id!);
  };
  const addedShot = draft.shots.length > expected.current.shots.length;
  const split = (stop: LngLat) => {
    if (!selected) return;
    try {
      const index = draft.shots.findIndex(s => s.id === selected), n = splitEditedShot(draft, hole.number, selected, stop, bag);
      setStops(history => [...history, { draft, selected }]);
      setDraft(n); setSelected(n.shots[index + 1].id!); setError(''); setDeleteConfirm(false); setRecenter(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to split this shot.'); }
  };
  const undoStop = () => {
    const previous = stops.at(-1); if (!previous) return;
    setDraft(previous.draft); setSelected(previous.selected); setStops(stops.slice(0, -1)); setError(''); setRecenter(n => n + 1);
  };
  const save = () => { try { onSave(expected.current, { ...draft, adj: draft.adj - (replaceAdjustment && addedShot ? 1 : 0) }); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save this edit.'); } };
  const features = draft.shots.flatMap((s, i) => s.pos && s.end ? [{ id: shotId(s, i, hole.number), start: s.pos, end: s.end, selected: s.id === selected }] : []);
  const lines: [LngLat, LngLat][] = features.map(s => [s.start, s.end]);
  return <div role="dialog" aria-modal="true" aria-label={`Edit hole ${hole.number}`} className="fixed inset-0 z-50 bg-[#1f3324] text-white">
    <div className="absolute inset-0">
      <MapBoundary><HoleMap hole={hole} from={selectedShot?.pos ?? base} here={null} pin={pin} target={null} review
        shotLines={lines} shotFeatures={features} recenter={recenter} padBottom={splitting ? 160 : selectedShot ? 250 : 260}
        focusPoints={selectedShot?.pos && selectedShot.end ? [selectedShot.pos, selectedShot.end] : undefined}
        labels={[]} shotTags={!selectedShot ? draft.shots.flatMap((s, i) => s.pos || s.end ? [{
          pos: s.pos && s.end ? midpoint(s.pos, s.end) : (s.pos ?? s.end)!, text: `Shot ${i + 1} · ${shortName(name(s.club))}${shotYards(s) != null ? ` · ${Math.round(shotYards(s)!)} yd` : ''}`, shotId: s.id,
        }] : []) : []}
        onSelectShot={choose} editing={selectedShot ? { start: selectedShot.pos, end: selectedShot.end, active: point, onPick: setPoint, onMove: move } : undefined}
        onTap={p => { if (splitting) split(p); else if (selectedShot) move(point, p); }} onClearTarget={() => {}} onPinMove={() => {}} /></MapBoundary>
    </div>
    <div className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 left-3 flex items-center justify-between gap-2">
      <div className="rounded-2xl bg-black/80 px-4 py-2 text-sm backdrop-blur"><b>Hole {hole.number} · Par {hole.par}</b>
        <span className="block text-[11px] text-white/65">{draft.completed ? 'Finished · editable' : 'Edit shots'}{activeHole && activeHole !== hole.number ? ` · playing hole ${activeHole}` : ''}</span></div>
    </div>
    <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] mx-auto max-w-lg space-y-2">
      <div className="rounded-3xl bg-[rgb(12_14_13/0.94)] p-4 shadow-xl backdrop-blur">
        {selectedShot ? splitting ? <>
          <div className="flex items-center justify-between gap-2"><b className="text-sm">Recover missed shots</b><span className="text-[10px] text-white/55">{draft.shots.length} {draft.shots.length === 1 ? 'shot' : 'shots'}</span>{stops.length > 0 && <button type="button" aria-label="Undo last ball stop" onClick={undoStop} className="min-h-11 text-xs text-[#d9e8cd]">Undo</button>}</div>
          <p className="mt-2 text-xs leading-relaxed text-white/65">Tap each earlier ball stop, in order. Your current position is already the final finish.</p>
        </> : <>
          <div className="flex items-center justify-between gap-2"><b className="text-sm">Shot {draft.shots.indexOf(selectedShot) + 1}{shotYards(selectedShot) != null ? ` · ${Math.round(shotYards(selectedShot)!)} y` : ''}</b>
            <button type="button" aria-label="Change shot club" onClick={() => setClubs(c => !c)} className="min-h-11 rounded-full bg-white px-4 text-xs font-semibold text-[#17251c]">{shortName(name(selectedShot.club))}⌄</button>
            <button type="button" className="min-h-11 text-xs text-white/70" onClick={() => { setSelected(null); setClubs(false); setRecenter(n => n + 1); }}>All shots</button></div>
          <div className="mt-2 flex gap-2">{(['pos', 'end'] as const).map(key => <button key={key} type="button" aria-pressed={point === key} onClick={() => setPoint(key)}
            className={`min-h-11 flex-1 rounded-xl border text-xs ${point === key ? 'border-orange bg-orange/10 text-orange' : 'border-white/30'}`}>{key === 'pos' ? 'Start' : 'Finish'}{selectedShot[key] ? '' : ' · set point'}</button>)}</div>
          <p className="mt-2 text-[11px] text-white/60">Drag {point === 'pos' ? 'Start' : 'Finish'}, or tap its new position. Arrow keys move 1 yd.</p>
          <div className="flex items-center justify-between gap-3"><button type="button" disabled={!selectedShot.pos || !selectedShot.end} onClick={() => { setStops([]); setSplitting(true); }} className="min-h-11 text-xs text-white/75 disabled:opacity-30">Split missed shots</button>
            <label className="flex min-h-11 items-center gap-1 text-xs text-white/75"><input type="checkbox" checked={selectedShot.mishit} onChange={e => update(h => { h.shots.find(s => s.id === selected)!.mishit = e.target.checked; })} />Mishit</label>
            <button type="button" className="min-h-11 text-xs text-[#ffb9a8]" onClick={() => { if (!deleteConfirm) return setDeleteConfirm(true); setDraft(h => deleteEditedShot(h, selected!)); setSelected(null); setDeleteConfirm(false); }}>{deleteConfirm ? 'Confirm delete' : 'Delete shot'}</button></div>
        </> : <>
          <div className="flex items-center justify-between gap-3"><b className="text-sm">{holeScore(draft)} strokes · {draft.shots.length} shots</b><button type="button" onClick={add} className="min-h-11 rounded-full border border-white/30 px-3 text-xs">+ Add shot</button></div>
          <p className="text-xs text-white/65">Tap a shot on the map to edit its start and finish.</p>
          {draft.shots.filter(s => !s.pos && !s.end).map((s, i) => <button type="button" key={s.id} onClick={() => choose(s.id!)} className="mt-1 min-h-11 rounded-full border border-white/30 px-3 text-xs">Unplaced shot {i + 1} · {name(s.club)}</button>)}
          <div className="mt-2 flex items-center gap-3 text-xs"><label className="flex items-center gap-2">Putts <input type="number" aria-label="Edit putt count" min="0" max="999" value={draft.putts}
            onChange={e => { const n = e.target.valueAsNumber; if (!Number.isSafeInteger(n) || n < 0 || n > 999) return; update(h => { h.putts = n; h.puttStarts = Array.from({ length: n }, () => null); h.log = [...h.log.filter(op => op !== 'putt'), ...Array.from({ length: n }, () => 'putt' as const)]; }); }} className="h-11 w-16 rounded-lg border border-white/25 bg-transparent px-2 text-base" /></label>
            <label className="flex items-center gap-2 text-white/60">Adjustment <input aria-label="Edit score adjustment" type="number" value={draft.adj} className="h-11 w-14 rounded-lg border border-white/25 bg-transparent px-2 text-base" onChange={e => { const n = e.target.valueAsNumber; if (Number.isSafeInteger(n) && holeScore(draft) - draft.adj + n >= 0) update(h => { h.adj = n; }); }} /></label></div>
          <div className="mt-2 flex items-center justify-between text-xs"><span className="text-white/65">Penalties</span><div className="flex items-center gap-3"><button type="button" aria-label="Remove penalty" disabled={!draft.penalties} className="size-11 rounded-xl border border-white/20 disabled:opacity-30" onClick={() => update(h => { h.penalties--; const index = h.log.lastIndexOf('pen'); if (index >= 0) h.log.splice(index, 1); })}>−</button><span>{draft.penalties}</span><button type="button" aria-label="Add penalty" className="size-11 rounded-xl border border-white/20" onClick={() => update(h => { h.penalties++; h.log.push('pen'); })}>+</button></div></div>
          {expected.current.adj > 0 && addedShot && <label className="mt-1 flex min-h-11 items-center gap-2 text-[11px] text-white/65"><input type="checkbox" checked={replaceAdjustment} onChange={e => setReplaceAdjustment(e.target.checked)} />Replace one score adjustment with the added shot</label>}
        </>}
        {error && <p role="alert" className="my-2 text-xs text-orange">{error}</p>}
        <div className="mt-2 flex items-center justify-between gap-3"><button type="button" onClick={onClose} className="min-h-11 text-xs text-white/70">Cancel</button>{splitting ? <button type="button" onClick={() => setSplitting(false)} className="min-h-11 rounded-xl bg-[#d9e8cd] px-5 text-sm font-semibold text-[#213d2b]">Done placing stops</button> : <button type="button" onClick={save} className="min-h-11 rounded-xl bg-[#d9e8cd] px-5 text-sm font-semibold text-[#213d2b]"><Flag className="mr-2 inline size-4" />Save changes</button>}</div>
      </div>
    </div>
    <ClubPicker bag={bag} selected={selectedShot?.club ?? null} open={clubs && !!selectedShot} onClose={() => setClubs(false)} onPick={club => { update(h => { const s = h.shots.find(s => s.id === selected); if (s) s.club = club; }); setClubs(false); }} />
  </div>;
}
