import { distYd, type LngLat } from './geo';
import type { Bag, HoleState } from '../schemas/round';

export type ReviewStroke = {
  kind: 'shot' | 'putt' | 'penalty';
  label: string;
  position: LngLat | null;
  end: LngLat | null;
  yards: number | null;
  estimated: boolean;
};

/** Replay only recorded positions. A missing endpoint never becomes a line to the pin. */
export function reviewStrokes(hole: HoleState, bag: Bag): ReviewStroke[] {
  const entries: ReviewStroke[] = [];
  const name = (club: string) => bag.clubs.find(c => c.id === club)?.name ?? club;
  let shot = 0, putt = 0;
  const log = hole.log.length ? hole.log : [
    ...hole.shots.map(() => 'shot' as const),
    ...Array.from({ length: hole.putts }, () => 'putt' as const),
    ...Array.from({ length: hole.penalties }, () => 'pen' as const),
  ];
  for (const action of log) {
    if (action === 'shot') {
      const s = hole.shots[shot++];
      if (!s) continue;
      entries.push({ kind: 'shot', label: `${name(s.club)}${s.mishit ? ' · mishit' : ''}`, position: s.pos, end: s.end,
        yards: s.end ? distYd(s.pos, s.end) : null, estimated: shot === hole.shots.length && hole.log.lastIndexOf('holed') > hole.log.lastIndexOf('shot') });
    } else if (action === 'putt') {
      const start = hole.puttStarts?.[putt];
      entries.push({ kind: 'putt', label: `Putter · putt ${++putt}`, position: start?.pos ?? null, end: null,
        yards: null, estimated: false });
    } else if (action === 'pen') {
      entries.push({ kind: 'penalty', label: 'Penalty stroke', position: null, end: null, yards: null, estimated: false });
    }
  }
  entries.forEach((entry, i) => {
    const next = entries[i + 1];
    if (entry.kind === 'putt' && entry.position && next?.position) {
      entry.end = next.position;
      entry.yards = distYd(entry.position, next.position);
    }
  });
  return entries;
}

export function reviewDistance(stroke: ReviewStroke) {
  if (stroke.kind === 'penalty') return 'Added to score';
  if (stroke.yards == null) return stroke.position ? 'Finish not recorded' : 'Position not recorded';
  return `${stroke.estimated ? '≈' : ''}${Math.round(stroke.yards)} yd${stroke.estimated ? ' · estimated finish' : ''}`;
}
