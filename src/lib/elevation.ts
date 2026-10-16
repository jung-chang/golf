// Ground elevation (feet) from the USGS 3DEP point query service. Phone GPS
// altitude is too noisy to compare with a green, so we look up the ground at
// the reported position instead. US only; null elsewhere or offline.
import type { LngLat } from './geo';

const cache = new Map<string, Promise<number | null>>();

export function elevationFt([lng, lat]: LngLat): Promise<number | null> {
  const key = `${Math.round(lng * 2e4)},${Math.round(lat * 2e4)}`; // ~5 m buckets
  let p = cache.get(key);
  if (!p) {
    p = fetch(`https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326`, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json() as Promise<{ value?: unknown }>)
      .then((j) => {
        const v = Number(j.value);
        return Number.isFinite(v) && v > -1000 ? v : null;
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

// Rule of thumb: each 3 ft of rise plays about a yard longer.
export const playsLike = (yards: number, fromFt: number, toFt: number) => yards + (toFt - fromFt) / 3;
