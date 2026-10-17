import { useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { cacheAge, fetchForecast, NYC, REQUEST_MS, WeatherCache, type TemperatureUnit } from './weather';

const KEY = 'golf.weather.v1';
const Settings = z.object({ version: z.literal(1), unit: z.enum(['fahrenheit', 'celsius']).default('fahrenheit'), cache: WeatherCache.nullable().default(null) });
type Settings = z.infer<typeof Settings>;
type State = Settings & { busy: boolean };
const defaults: Settings = { version: 1, unit: 'fahrenheit', cache: null };
function read(): Settings {
  try { const parsed = Settings.safeParse(JSON.parse(localStorage.getItem(KEY) ?? 'null')); if (parsed.success) return parsed.data; } catch { /* optional device settings */ }
  return defaults;
}
let state: State = { ...read(), busy: false };
const listeners = new Set<() => void>();
function update(patch: Partial<State>, persist = false) {
  state = { ...state, ...patch };
  // Storage can be blocked (private mode); settings then last for this visit only.
  if (persist) try { const { version, unit, cache } = state; localStorage.setItem(KEY, JSON.stringify({ version, unit, cache })); } catch { /* this visit only */ }
  listeners.forEach(l => l());
}
export function setTemperatureUnit(unit: TemperatureUnit) { update({ unit }, true); }
export const getTemperatureUnit = () => state.unit;

// Weather is always on: fetch when the cache isn't fresh. Failures keep the old cache; chips just show less.
export async function refreshWeather() {
  if (state.busy || !navigator.onLine || (state.cache && cacheAge(state.cache) === 'fresh')) return;
  update({ busy: true });
  try {
    const forecast = await fetchForecast(NYC, AbortSignal.timeout(REQUEST_MS));
    update({ cache: { forecast, fetchedAt: Date.now() } }, true);
  } catch { /* keep the previous forecast */ }
  finally { update({ busy: false }); }
}

addEventListener('online', () => void refreshWeather());
addEventListener('storage', event => { if (event.key === KEY || event.key === null) update({ ...read() }); });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useWeather() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    void refreshWeather();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const resume = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void refreshWeather(); } };
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', resume); };
  }, []);
  return { ...snapshot, now: Math.max(now, Date.now()) };
}
