import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { holeScore } from '@/lib/round';
import { reviewDistance, reviewStrokes } from '@/lib/hole-review';
import { cn } from '@/lib/utils';
import type { Hole } from '@/schemas/course';
import type { Bag, HoleState } from '@/schemas/round';
import { HoleMap, labelAt } from './HoleMap';
import type { LngLat } from '@/lib/geo';
import { shortName } from '@/lib/clubs';

export function HoleReview({ hole, state, bag, onClose }: { hole: Hole; state: HoleState; bag: Bag; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const strokes = reviewStrokes(state, bag);
  const shown = strokes.flatMap((stroke, index) => selected == null || selected === index ? [{ ...stroke, index }] : []);
  const lines: [LngLat, LngLat][] = shown.flatMap(s => s.position && s.end ? [[s.position, s.end]] : []);
  const labels = shown.flatMap(s => {
    if (!s.position) return [];
    // Whole-hole short-game labels would overlap at course scale. Numbered
    // markers link to the full club/distance rows; selecting a stroke expands it.
    if (selected == null && (s.yards == null || s.yards < 35)) return [{ pos: s.position, text: String(s.index + 1), compact: true,
      offset: [(s.index % 2 ? -1 : 1) * 20, (s.index % 3 - 1) * 15] as [number, number] }];
    return [s.end ? labelAt(s.position, s.end, `${s.index + 1}. ${shortName(s.label)} · ${reviewDistance(s)}`)
      : { pos: s.position, text: `${s.index + 1}. ${shortName(s.label)}` }];
  });
  const from = shown.find(s => s.position)?.position ?? hole.green.center;
  return <Drawer open onOpenChange={open => { if (!open) onClose(); }}>
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Hole {hole.number} · Par {hole.par}</DrawerTitle>
        <DrawerDescription>{holeScore(state)} strokes · {state.putts} putts · {state.completed ? 'Hole complete' : 'Recorded shots'}</DrawerDescription>
      </DrawerHeader>
      <div data-vaul-no-drag className="relative h-[40dvh] min-h-60 shrink-0" aria-label="Hole shot review map">
        <HoleMap hole={hole} review from={from} here={null} pin={state.pin ?? hole.green.center} target={null}
          labels={labels} shotLines={lines} recenter={selected == null ? -1 : selected}
          onTap={() => {}} onClearTarget={() => {}} onPinMove={() => {}} />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
        <Button variant="outline" size="icon" className="size-11" aria-label="Previous stroke" disabled={!strokes.length || selected === 0}
          onClick={() => setSelected(selected == null ? strokes.length - 1 : Math.max(0, selected - 1))}><ChevronLeft /></Button>
        <Button variant={selected == null ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={selected == null} onClick={() => setSelected(null)}>Whole hole</Button>
        <Button variant="outline" size="icon" className="size-11" aria-label="Next stroke" disabled={!strokes.length || selected === strokes.length - 1}
          onClick={() => setSelected(selected == null ? 0 : Math.min(strokes.length - 1, selected + 1))}><ChevronRight /></Button>
      </div>
      <p role="status" aria-label="Replay position" className="shrink-0 px-4 pt-2 text-xs text-muted-foreground">
        {selected == null ? 'Whole hole · tap a stroke or use the arrows to replay' : `Stroke ${selected + 1} of ${strokes.length} · ${strokes[selected].label} · ${reviewDistance(strokes[selected])}`}
      </p>
      <div className="min-h-0 overflow-y-auto px-4 pb-4">
        {!strokes.length && <p className="py-3 text-sm text-muted-foreground">No strokes recorded for this hole.</p>}
        {strokes.map((s, i) => <button key={i} type="button" aria-label={`Stroke ${i + 1}: ${s.label}, ${reviewDistance(s)}`} aria-pressed={selected === i} onClick={() => setSelected(i)}
          className={cn('mt-2 flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm', selected === i && 'border-primary bg-secondary')}>
          <b className="grid size-7 shrink-0 place-content-center rounded-full bg-primary text-primary-foreground">{i + 1}</b>
          <span className="flex-1">{s.label}</span><span className="text-right text-xs text-muted-foreground">{reviewDistance(s)}</span>
        </button>)}
        {state.adj !== 0 && <p className="mt-2 text-xs text-muted-foreground">Score includes {state.adj > 0 ? '+' : ''}{state.adj} manual adjustment; those strokes have no recorded order or position.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Lines join saved positions. Missing finishes are left unmeasured; the pin remains an estimate.</p>
      </div>
    </DrawerContent>
  </Drawer>;
}
