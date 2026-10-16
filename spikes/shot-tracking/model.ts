// Spike only: proposed rules, not used by the production app.
import { distYd, M_TO_YD, type LngLat } from '../../src/lib/geo';

export type YardageRange = { low: number; high: number };
export type StockClub = { id: string; name: string; full: YardageRange | null; chip: YardageRange | null; enabled: boolean };
export type Intent = 'full' | 'chip';
export type LocationSample = { pos: LngLat; accuracyM: number; acquiredAt: number };
export type ShotStart = LocationSample & { markedAt: number };

// Product hypotheses to validate outdoors, not sensor accuracy guarantees.
export const MAX_FIX_AGE_MS = 8_000;
const ACCURACY_LIMIT_M = { full: 8, chip: 3 };

export function validPoint(pos: LngLat): boolean {
  return Array.isArray(pos) && pos.length === 2 && pos.every(Number.isFinite) && Math.abs(pos[0]) <= 180 && Math.abs(pos[1]) <= 90;
}

export function validRange(range: YardageRange | null): range is YardageRange {
  return !!range && Number.isFinite(range.low) && Number.isFinite(range.high) && range.low > 0 && range.high >= range.low;
}

export function fixUsable(fix: LocationSample | null, now: number, intent: Intent): boolean {
  return !!fix && Number.isFinite(fix.acquiredAt) && fix.acquiredAt >= 0 && fix.acquiredAt <= now && now - fix.acquiredAt <= MAX_FIX_AGE_MS
    && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 && fix.accuracyM <= ACCURACY_LIMIT_M[intent]
    && validPoint(fix.pos);
}

type Candidate = { club: StockClub; range: YardageRange };
export type Recommendation = {
  status: 'suggested' | 'between-clubs' | 'outside-ranges' | 'no-stock-range' | 'needs-location';
  primary: Candidate | null;
  alternatives: Candidate[];
};

export function recommend(distanceYd: number, clubs: StockClub[], fix: LocationSample | null, now: number, intent: Intent): Recommendation {
  const empty = { primary: null, alternatives: [] };
  if (!Number.isFinite(distanceYd) || distanceYd < 0 || !fixUsable(fix, now, intent)) return { status: 'needs-location', ...empty };
  const configured: Candidate[] = clubs.flatMap(club => {
    const range = club[intent];
    return club.enabled && validRange(range) ? [{ club, range }] : [];
  });
  if (!configured.length) return { status: 'no-stock-range', ...empty };
  const radius = fix!.accuracyM * M_TO_YD;
  const overlaps = configured.filter(({ range }) => range.low <= distanceYd + radius && range.high >= distanceYd - radius);
  const middleDistance = ({ range }: Candidate) => Math.abs((range.low + range.high) / 2 - distanceYd);
  overlaps.sort((a, b) => middleDistance(a) - middleDistance(b) || a.range.high - b.range.high || a.club.id.localeCompare(b.club.id));
  const fits = overlaps.filter(({ range }) => range.low <= distanceYd && range.high >= distanceYd);
  if (!fits.length) return { status: overlaps.length ? 'between-clubs' : 'outside-ranges', primary: null, alternatives: overlaps };
  const primary = fits[0];
  return { status: 'suggested', primary, alternatives: overlaps.filter(c => c !== primary) };
}

export type ShotMeasurement = { yards: number | null; envelope: YardageRange | null; usableForStats: boolean; intent: Intent };

export function measureShot(start: ShotStart, end: LocationSample, now: number, intent: Intent, endpoint: 'measured' | 'estimated-pin', mishit = false): ShotMeasurement {
  if (!validPoint(start.pos) || !validPoint(end.pos) || !Number.isFinite(start.accuracyM) || !Number.isFinite(end.accuracyM) || start.accuracyM < 0 || end.accuracyM < 0) {
    return { yards: null, envelope: null, usableForStats: false, intent };
  }
  const yards = distYd(start.pos, end.pos);
  // Conditional envelope if BOTH actual positions fall within the reported radii.
  // This is not a calibrated 95% confidence interval for distance.
  const uncertaintyYd = (start.accuracyM + end.accuracyM) * M_TO_YD;
  const endGood = fixUsable(end, now, intent);
  // Validate start at capture time; saved starts naturally age during flight/walking.
  const startGood = start.markedAt <= end.acquiredAt && fixUsable(start, start.markedAt, intent);
  return {
    yards,
    envelope: { low: Math.max(0, yards - uncertaintyYd), high: yards + uncertaintyYd },
    usableForStats: endpoint === 'measured' && !mishit && startGood && endGood && yards > 0 && uncertaintyYd <= yards * 0.2,
    intent,
  };
}

export type ShotAction = { type: 'shot' | 'putt'; club: string; intent: Intent; fix: ShotStart };
export type MeasuredShot = { index: number; club: string; start: ShotStart; end: ShotStart; measurement: ShotMeasurement };

export function appendAction(actions: ShotAction[], action: ShotAction) {
  const previous = actions.at(-1);
  const elapsed = previous ? action.fix.markedAt - previous.fix.markedAt : Infinity;
  const duplicate = action.type === 'shot' && previous?.type === 'shot' && action.club === previous.club
    && action.intent === previous.intent && elapsed >= 0 && elapsed < 1_200;
  return { duplicate, actions: duplicate ? actions : [...actions, action] };
}

// Derive the ledger from actions so Undo also restores the prior open endpoint.
// The next shot OR first putt closes a shot. Later putts never close it again.
export function shotLedger(actions: ShotAction[]) {
  let pending: { index: number; action: ShotAction } | null = null;
  const completed: MeasuredShot[] = [];
  let shots = 0, putts = 0;
  for (const action of actions) {
    if (pending) {
      completed.push({ index: pending.index, club: pending.action.club, start: pending.action.fix, end: action.fix,
        measurement: measureShot(pending.action.fix, action.fix, action.fix.markedAt, pending.action.intent, 'measured') });
      pending = null;
    }
    if (action.type === 'shot') { shots++; pending = { index: shots, action }; }
    else putts++;
  }
  return { shots, putts, completed, pending };
}

export function greenView(distanceYd: number, previous: 'course' | 'green', freshFix: boolean, override: 'course' | 'green' | null = null): 'course' | 'green' {
  if (override) return override;
  if (!freshFix || !Number.isFinite(distanceYd) || distanceYd < 0) return previous;
  // Hysteresis avoids camera switches around one distance threshold.
  return previous === 'course' ? distanceYd <= 60 ? 'green' : 'course' : distanceYd >= 90 ? 'course' : 'green';
}
