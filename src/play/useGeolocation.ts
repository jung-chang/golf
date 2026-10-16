import { useCallback, useEffect, useRef, useState } from 'react';
import { distM, type LngLat } from '../lib/geo';

export type Fix = { pos: LngLat; acc: number; t: number };

// GPS jitters while you stand still, so use the most accurate of the last few
// seconds' readings — but only ones that agree with the latest, or a reading
// from before you walked to your ball would win.
export function bestFix(fixes: Fix[], now: number): Fix | null {
  const latest = fixes.at(-1);
  if (!latest) return null;
  return fixes
    .filter((f) => now - f.t < 8000 && distM(f.pos, latest.pos) <= f.acc + latest.acc)
    .reduce((a, b) => (b.acc <= a.acc ? b : a), latest);
}

export function useGeolocation() {
  const fixes = useRef<Fix[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  const push = useCallback((pos: LngLat, acc: number) => {
    const f = { pos, acc, t: Date.now() };
    fixes.current = [...fixes.current.slice(-9), f];
    setFix(bestFix(fixes.current, f.t));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return setError('No GPS on this device');
    const id = navigator.geolocation.watchPosition(
      (p) => { setError(null); push([p.coords.longitude, p.coords.latitude], p.coords.accuracy); },
      (e) => setError(e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [push]);

  // `fix` is already the best recent reading; `inject` is for ?sim testing.
  return { fix, error, inject: push };
}

// Keep the screen on during a round (re-acquired when the app comes back).
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    const onVis = () => document.visibilityState === 'visible' && get();
    get();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, []);
}
