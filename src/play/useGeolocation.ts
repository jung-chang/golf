import { useCallback, useEffect, useRef, useState } from 'react';
import { distM, type LngLat } from '../lib/geo';
import { validFix } from '../lib/tracking';

export type Fix = { pos: LngLat; acc: number; t: number };
export function bestFix(fixes: Fix[], now: number): Fix | null {
  const recent = fixes.filter(f => validFix(f, now, Number.MAX_VALUE));
  const latest = recent.at(-1);
  if (!latest) return null;
  return recent.filter(f => distM(f.pos, latest.pos) <= f.acc + latest.acc)
    .reduce((a, b) => b.acc <= a.acc ? b : a, latest);
}
export function useGeolocation() {
  const fixes = useRef<Fix[]>([]);
  const settled = useRef<{ pos: LngLat; since: number } | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const clear = useCallback(() => { fixes.current = []; settled.current = null; setFix(null); }, []);
  const push = useCallback((pos: LngLat, acc: number, t = Date.now()) => {
    const clock = Date.now(), f = { pos, acc, t };
    if (!validFix(f, clock, Number.MAX_VALUE)) { clear(); return; }
    if (!settled.current || distM(settled.current.pos, pos) > Math.max(4, Math.min(acc, 8))) settled.current = { pos, since: clock };
    fixes.current = [...fixes.current.slice(-9), f];
    setFix(bestFix(fixes.current, clock)); setError(null); setNow(clock);
  }, [clear]);
  useEffect(() => {
    const timer = setInterval(() => {
      const clock = Date.now(); setNow(clock);
      setFix(previous => previous && validFix(previous, clock, Number.MAX_VALUE) ? previous : null);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(location.search).has('sim')) return;
    if (!navigator.geolocation) { setError('No GPS on this device'); return; }
    let id: number;
    const watch = () => {
      clear();
      id = navigator.geolocation.watchPosition(p => push([p.coords.longitude, p.coords.latitude], p.coords.accuracy, p.timestamp),
        e => { clear(); setError(e.message); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    };
    const resume = () => {
      if (document.visibilityState === 'visible') { navigator.geolocation.clearWatch(id); watch(); }
      else clear();
    };
    watch(); document.addEventListener('visibilitychange', resume);
    return () => { navigator.geolocation.clearWatch(id); document.removeEventListener('visibilitychange', resume); };
  }, [push, clear]);
  return { fix, error, inject: push, settledMs: fix && settled.current ? Math.max(0, now - settled.current.since) : 0 };
}
export function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null, disposed = false;
    const get = () => navigator.wakeLock?.request('screen').then(l => { if (disposed) void l.release(); else lock = l; }).catch(() => {});
    const onVis = () => { if (document.visibilityState === 'visible') get(); };
    get(); document.addEventListener('visibilitychange', onVis);
    return () => { disposed = true; document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, []);
}
