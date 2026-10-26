import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import type { Bag, HoleState } from '../schemas/round';
import type { Hole } from '../schemas/course';
import { holeScore } from '../lib/round';
import { deleteEditedShot, insertEditedShot, prepareHole, shotId, splitEditedShot, stockClubFor, validFix, type ShotFix } from '../lib/tracking';
import { midpoint, type LngLat } from '../lib/geo';
import { shortName, shotYards } from '../lib/clubs';
import { HoleMap } from './HoleMap';
import { ClubPicker } from './ClubPicker';
import { MapBoundary } from './MapBoundary';

export function HoleEditor({ hole, state, bag, teeId, activeHole, here = null, initialShot, initialDraft, initialSplit = false, onClose, onSave, onFinish, onCancelTracking }: {
  hole: Hole; state: HoleState; bag: Bag; teeId: string; activeHole?: number; initialShot?: string;
  here?: ShotFix | null;
  initialDraft?: HoleState; initialSplit?: boolean; onClose: () => void; onSave: (expected: HoleState, draft: HoleState) => void;
  onFinish?: (expected: HoleState, draft: HoleState) => void; onCancelTracking?: () => void;
}) {
  const expected = useRef(structuredClone(state));
  const [draft, setDraft] = useState(() => prepareHole(initialDraft ?? state, hole.number));
  const [selected, setSelected] = useState<string | null>(initialShot ?? null);
  const [point, setPoint] = useState<'pos' | 'end'>('pos');
  const [clubs, setClubs] = useState(false), [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState(''), [recenter, setRecenter] = useState(0);
  const [replaceAdjustment, setReplaceAdjustment] = useState(false);
  const [splitting, setSplitting] = useState(initialSplit);
  const [stops, setStops] = useState<{ draft: HoleState; selected: string }[]>([]);
  const panel = useRef<HTMLDivElement>(null), [panelHeight, setPanelHeight] = useState(80);
  useEffect(() => {
    if (!panel.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (panel.current) setPanelHeight(Math.ceil(panel.current.getBoundingClientRect().height) + 20); });
    observer.observe(panel.current); return () => observer.disconnect();
  }, []);
  const selectedShot = draft.shots.find(s => s.id === selected);
  const name = (club: string) => bag.clubs.find(c => c.id === club)?.name ?? club;
  const base = hole.tees?.[teeId]?.pos ?? hole.path?.[0] ?? hole.green.center;
  const pin = draft.pin ?? hole.green.center;
  const update = (fn: (h: HoleState) => void) => setDraft(h => { const n = structuredClone(h); fn(n); return n; });
  const choose = (id: string) => { setSelected(id === selected ? null : id); setPoint('pos'); setClubs(false); setSplitting(false); setDeleteConfirm(null); setRecenter(n => n + 1); };
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
      setDraft(n); setSelected(n.shots[index + 1].id!); setError(''); setDeleteConfirm(null); setRecenter(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to split this shot.'); }
  };
  const undoStop = () => {
    const previous = stops.at(-1); if (!previous) return;
    setDraft(previous.draft); setSelected(previous.selected); setStops(stops.slice(0, -1)); setError(''); setRecenter(n => n + 1);
  };
  const save = (finish = false) => { try { (finish && onFinish ? onFinish : onSave)(expected.current, { ...draft, adj: draft.adj - (replaceAdjustment && addedShot ? 1 : 0) }); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save this edit.'); } };
  const features = draft.shots.flatMap((s, i) => s.pos && s.end ? [{ id: shotId(s, i, hole.number), start: s.pos, end: s.end, selected: s.id === selected }] : []);
  const lines: [LngLat, LngLat][] = features.map(s => [s.start, s.end]);
  return <div role="dialog" aria-modal="true" aria-label={`Edit hole ${hole.number}`} className="fixed inset-0 z-50 bg-[#1f3324] text-white">
    <div className="absolute inset-0">
      <MapBoundary><HoleMap hole={hole} from={selectedShot?.pos ?? base} here={null} pin={pin} target={null} review
        shotLines={lines} shotFeatures={features} recenter={recenter} padBottom={panelHeight}
        focusPoints={selectedShot?.pos && selectedShot.end ? [selectedShot.pos, selectedShot.end] : undefined}
        labels={[]} shotTags={draft.shots.flatMap((s, i) => (!selectedShot || selectedShot.id === s.id) && (s.pos || s.end || selectedShot) ? [{
          pos: s.pos && s.end ? midpoint(s.pos, s.end) : s.pos ?? s.end ?? base, text: `Shot ${i + 1}${selectedShot ? ' · All shots' : ` · ${shortName(name(s.club))}`}${shotYards(s) != null ? ` · ${Math.round(shotYards(s)!)} yd` : ''}`, shotId: s.id, actionLabel: selectedShot ? 'All shots' : `Edit shot ${i + 1}, ${name(s.club)}`, offset: selectedShot ? [0, -50] as [number, number] : undefined,
        }] : [])}
        onSelectShot={choose} editing={selectedShot ? { start: selectedShot.pos, end: selectedShot.end, active: point, onPick: setPoint, onMove: move } : undefined}
        onTap={p => { if (splitting) split(p); else if (selectedShot) move(point, p); }} onClearTarget={() => {}} onPinMove={() => {}} /></MapBoundary>
    </div>
    <div className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 left-3 flex items-center justify-between gap-2">
      <div className="rounded-xl bg-black/80 px-3 py-2 text-xs backdrop-blur"><b>Hole {hole.number}</b><span className="ml-2 text-white/60">{selectedShot ? `Shot ${draft.shots.indexOf(selectedShot) + 1}` : `Par ${hole.par}`}{activeHole && activeHole !== hole.number ? ` · playing ${activeHole}` : ''}</span></div>
    </div>
    <div ref={panel} className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] mx-auto max-w-lg">
      <div className="rounded-[20px] bg-[rgb(12_14_13/0.94)] p-2 shadow-xl backdrop-blur">
        {splitting ? <div className="px-2 pt-2">
          <div className="flex items-center justify-between gap-2"><b className="text-sm">Recover missed shots</b><span className="text-[10px] text-white/55">{draft.shots.length} shots</span>{stops.length > 0 && <button type="button" aria-label="Undo last ball stop" onClick={undoStop} className="min-h-11 text-xs text-[#d9e8cd]">Undo</button>}</div>
          <p className="my-2 text-xs leading-relaxed text-white/65">Tap each earlier ball stop, in order. The final finish is already set.</p>
        </div> : !selectedShot ? <div className="max-h-[48dvh] overflow-y-auto px-2 pt-1">
          <div className="flex items-center justify-between gap-3"><b className="text-sm">{holeScore(draft)} strokes</b><button type="button" onClick={add} className="min-h-11 px-2 text-xs text-[#d9e8cd]">+ Add shot</button></div>
          {draft.shots.length > 0 && <div className="max-h-[22dvh] overflow-y-auto divide-y divide-white/10">
            {draft.shots.map((s, i) => <div key={s.id} className="flex items-center gap-1">
              <button type="button" aria-label={`Edit shot ${i + 1}, ${name(s.club)}`} onClick={() => choose(s.id!)} className="min-h-11 min-w-0 flex-1 text-left text-xs"><b>{i + 1} · {shortName(name(s.club))}</b><span className="ml-2 text-white/50">{shotYards(s) != null ? `${Math.round(shotYards(s)!)} yd` : 'Set location'}</span></button>
              <label className="flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 text-[8px] text-white/50"><input type="checkbox" aria-label={`Shot ${i + 1} mishit`} checked={s.mishit} onChange={e => update(h => { h.shots[i].mishit = e.target.checked; })} />Mishit</label>
              <button type="button" aria-label={`Split shot ${i + 1}`} disabled={!s.pos || !s.end} onClick={() => { setSelected(s.id!); setStops([]); setSplitting(true); setRecenter(n => n + 1); }} className="grid size-11 shrink-0 place-content-center text-xs text-white/70 disabled:opacity-25">Split</button>
              <button type="button" aria-label={deleteConfirm === s.id ? `Confirm delete shot ${i + 1}` : `Delete shot ${i + 1}`} onClick={() => { if (deleteConfirm !== s.id) return setDeleteConfirm(s.id!); setDraft(h => deleteEditedShot(h, s.id!)); setDeleteConfirm(null); }} className="grid size-11 shrink-0 place-content-center text-[#efb69e]">{deleteConfirm === s.id ? <span className="text-[10px]">Delete?</span> : <Trash2 className="size-4" />}</button>
            </div>)}
          </div>}
          <div className="my-2 grid grid-cols-3 gap-3 text-[10px] text-white/60">
            <label>Putts<input type="number" aria-label="Edit putt count" min="0" max="999" value={draft.putts} onChange={e => { const n = e.target.valueAsNumber; if (Number.isSafeInteger(n) && n >= 0 && n <= 999) update(h => { h.putts = n; h.puttStarts = Array.from({ length: n }, () => null); h.log = [...h.log.filter(op => op !== 'putt'), ...Array.from({ length: n }, () => 'putt' as const)]; }); }} className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-base text-white" /></label>
            <label>Penalties<input type="number" aria-label="Edit penalties" min="0" max="999" value={draft.penalties} onChange={e => { const n = e.target.valueAsNumber; if (Number.isSafeInteger(n) && n >= 0 && n <= 999) update(h => { h.penalties = n; h.log = [...h.log.filter(op => op !== 'pen'), ...Array.from({ length: n }, () => 'pen' as const)]; }); }} className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-base text-white" /></label>
            <label>Adjustment<input aria-label="Edit score adjustment" type="number" value={draft.adj} onChange={e => { const n = e.target.valueAsNumber; if (Number.isSafeInteger(n) && holeScore(draft) - draft.adj + n >= 0) update(h => { h.adj = n; }); }} className="mt-1 h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-base text-white" /></label>
          </div>
          {expected.current.adj > 0 && addedShot && <label className="flex min-h-11 items-center gap-2 text-[11px] text-white/65"><input type="checkbox" checked={replaceAdjustment} onChange={e => setReplaceAdjustment(e.target.checked)} />Replace one score adjustment with this shot</label>}
          {onCancelTracking && <button type="button" onClick={onCancelTracking} className="min-h-11 w-full text-xs text-[#efb69e]">Cancel tracking</button>}
        </div> : null}
        {error && <p role="alert" className="my-2 text-xs text-orange">{error}</p>}
        <div data-editor-bar className="flex items-center gap-2">
          {selectedShot && !splitting ? <button type="button" aria-label="Change shot club" onClick={() => setClubs(true)} className="flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-sm font-medium"><span className="max-w-20 truncate">{shortName(name(selectedShot.club))}</span><ChevronDown className="size-3.5 text-white/50" /></button> : <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-xl px-3 text-sm text-white/70">Cancel</button>}
          {splitting ? <button type="button" onClick={() => { setSplitting(false); setSelected(null); }} className="min-h-12 flex-1 rounded-xl bg-[#d9e8cd] px-3 text-sm font-semibold text-[#213d2b]">Review shots</button> : <button type="button" onClick={() => save(!selectedShot && !!onFinish)} disabled={!selectedShot && !!onFinish && !!draft.pendingShot} className="min-h-12 min-w-0 flex-1 rounded-xl bg-[#d9e8cd] px-3 text-sm font-semibold whitespace-nowrap text-[#213d2b] disabled:opacity-40">{!selectedShot && onFinish ? 'Finish hole' : 'Save changes'}</button>}
        </div>
      </div>
    </div>
    <ClubPicker bag={bag} selected={selectedShot?.club ?? null} open={clubs && !!selectedShot} onClose={() => setClubs(false)} onPick={club => { update(h => { const s = h.shots.find(s => s.id === selected); if (s) s.club = club; }); setClubs(false); }} />
  </div>;
}
