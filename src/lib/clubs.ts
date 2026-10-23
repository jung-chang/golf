import type { Bag, Club, Round, Shot } from '../schemas/round';
import { distYd, median } from './geo';

export const PUTTER = 'pt';
export const MIN_TRACKED = 3;

export function defaultBag(): Bag {
  const clubs: [string, string, number | null][] = [
    ['dr', 'Driver', 230], ['3w', '3 Wood', 210], ['5w', '5 Wood', 195], ['4h', '4 Hybrid', 185],
    ['5i', '5 Iron', 175], ['6i', '6 Iron', 165], ['7i', '7 Iron', 155], ['8i', '8 Iron', 145],
    ['9i', '9 Iron', 135], ['pw', 'PW', 125], ['gw', 'GW', 110], ['sw', 'SW', 95], ['lw', 'LW', 75],
    [PUTTER, 'Putter', null],
  ];
  return {
    clubs: clubs.map(([id, name, stock]) => ({ id, name, stock, on: true })),
    useTracked: true,
    updatedAt: new Date(0).toISOString(),
  };
}

export const shotYards = (s: Shot) => (s.end ? distYd(s.pos, s.end) : null);

// Longer than anyone hits it: a shot marked from somewhere else (testing at home, a stale fix).
export const MAX_SHOT_YD = 400;

export const shortName = (name: string) => name.replace(' Iron', 'i').replace(' Wood', 'W').replace(' Hybrid', 'H');

export type TrackedShot = { club: string; yd: number; t: number };

// Every measured full shot (no putts, no mishits), oldest first.
export function trackedShots(rounds: Round[]): TrackedShot[] {
  const out: TrackedShot[] = [];
  for (const r of rounds) {
    for (const h of Object.values(r.holes)) {
      for (const s of h.shots) {
        if (s.club === PUTTER || s.mishit || !s.end) continue;
        const yd = shotYards(s)!;
        if (yd > MAX_SHOT_YD) continue;
        out.push({ club: s.club, yd, t: s.t });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export type ClubStat = { n: number; median: number; recent: number };

// Per club: all-time median and median of the last 10 shots.
export function clubStats(rounds: Round[]): Record<string, ClubStat> {
  const by: Record<string, number[]> = {};
  for (const s of trackedShots(rounds)) (by[s.club] ??= []).push(s.yd);
  return Object.fromEntries(Object.entries(by).map(([id, yds]) => [id, { n: yds.length, median: median(yds)!, recent: median(yds.slice(-10))! }]));
}

export function clubYards(club: Club, stats: Record<string, ClubStat>, useTracked: boolean): number | null {
  const st = stats[club.id];
  if (useTracked && st && st.n >= MIN_TRACKED) return Math.round(st.recent);
  return club.stock;
}

type Pick = Club & { yards: number };

// Shortest club that gets there (within 4 yd), else the longest club.
export function suggestClub(target: number, bag: Bag, stats: Record<string, ClubStat>): { club: Pick; longer: Pick | null } | null {
  const clubs = bag.clubs
    .filter((c) => c.on && c.id !== PUTTER)
    .map((c) => ({ ...c, yards: clubYards(c, stats, bag.useTracked) }))
    .filter((c): c is Pick => c.yards != null)
    .sort((a, b) => a.yards - b.yards);
  if (!clubs.length) return null;
  const i = clubs.findIndex((c) => c.yards >= target - 4);
  const pick = i === -1 ? clubs.length - 1 : i;
  return { club: clubs[pick], longer: clubs[pick + 1] ?? null };
}
