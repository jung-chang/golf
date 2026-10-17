import { z } from 'zod';

export type TemperatureUnit = 'fahrenheit' | 'celsius';
export const FRESH_MS = 3 * 60 * 60_000;
export const MAX_CACHE_MS = 24 * 60 * 60_000;
export const REQUEST_MS = 10_000;
export const Coordinates = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
/** Every course is in NYC, so one central point stands in for all of them; no device location is used. */
export const NYC = { latitude: 40.73, longitude: -73.94 };
const Temperature = z.number().min(-100).max(70);
const Day = z.object({ date: z.iso.date(), code: z.number().int(), high: Temperature, low: Temperature }).refine(d => d.low <= d.high);
export const Forecast = z.object({
  timezone: z.string().refine(zone => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } }),
  days: z.array(Day).max(16),
});
export type Forecast = z.infer<typeof Forecast>;
export type WeatherDay = z.infer<typeof Day>;
export const WeatherCache = z.object({ fetchedAt: z.number().int().nonnegative(), forecast: Forecast });
export type WeatherCache = z.infer<typeof WeatherCache>;

const conditions: Record<number, [string, string]> = {
  0: ['Clear sky', 'clear-day'], 1: ['Mainly clear', 'clear-day'], 2: ['Partly cloudy', 'partly-cloudy-day'], 3: ['Overcast', 'overcast'],
  45: ['Fog', 'fog'], 48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Moderate drizzle', 'drizzle'], 55: ['Dense drizzle', 'drizzle'],
  56: ['Light freezing drizzle', 'sleet'], 57: ['Dense freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'], 63: ['Moderate rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Light freezing rain', 'sleet'], 67: ['Heavy freezing rain', 'sleet'],
  71: ['Light snow', 'snow'], 73: ['Moderate snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light rain showers', 'partly-cloudy-day-rain'], 81: ['Moderate rain showers', 'partly-cloudy-day-rain'], 82: ['Violent rain showers', 'rain'],
  85: ['Light snow showers', 'partly-cloudy-day-snow'], 86: ['Heavy snow showers', 'partly-cloudy-day-snow'],
  95: ['Thunderstorm', 'thunderstorms'], 97: ['Heavy thunderstorm', 'thunderstorms'],
  96: ['Thunderstorm with light hail', 'thunderstorms-hail'], 99: ['Thunderstorm with heavy hail', 'thunderstorms-hail'],
};
export function condition(code?: number | null) {
  const entry = code == null ? undefined : conditions[code];
  return { label: entry?.[0] ?? 'Weather unavailable', icon: entry?.[1] ?? 'not-available', available: !!entry };
}
export function temperature(celsius: number, unit: TemperatureUnit) {
  if (!Number.isFinite(celsius)) return '—';
  const rounded = Math.round(unit === 'fahrenheit' ? celsius * 9 / 5 + 32 : celsius);
  return `${Object.is(rounded, -0) ? 0 : rounded}°`;
}

// ISO calendar dates from timezone=auto are already local days, never UTC instants.
export function dateInZone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function cacheAge(cache: WeatherCache, now = Date.now()) {
  const age = now - cache.fetchedAt;
  return age < 0 || age >= MAX_CACHE_MS ? 'expired' : age >= FRESH_MS ? 'stale' : 'fresh';
}
export function forecastDay(cache: WeatherCache | null, date: string, now = Date.now()) {
  if (!cache || cacheAge(cache, now) === 'expired' || date < dateInZone(cache.forecast.timezone, new Date(now))) return undefined;
  return cache.forecast.days.find(d => d.date === date && condition(d.code).available);
}

const Response = z.object({
  timezone: Forecast.shape.timezone,
  daily_units: z.object({ time: z.literal('iso8601'), weather_code: z.literal('wmo code'), temperature_2m_max: z.literal('°C'), temperature_2m_min: z.literal('°C') }),
  daily: z.object({ time: z.array(z.iso.date()).min(1).max(16), weather_code: z.array(z.number().int().nullable()), temperature_2m_max: z.array(Temperature.nullable()), temperature_2m_min: z.array(Temperature.nullable()) }),
});
export function parseForecast(value: unknown): Forecast {
  const { timezone, daily: d } = Response.parse(value);
  if ([d.weather_code, d.temperature_2m_max, d.temperature_2m_min].some(a => a.length !== d.time.length)) throw new Error('Invalid daily arrays');
  if (d.time.some((date, i) => i > 0 && Date.parse(`${date}T12:00:00Z`) - Date.parse(`${d.time[i - 1]}T12:00:00Z`) !== 86_400_000)) throw new Error('Invalid daily dates');
  const days = d.time.flatMap((date, i) => {
    const code = d.weather_code[i], high = d.temperature_2m_max[i], low = d.temperature_2m_min[i];
    if (code === null || high === null || low === null || !condition(code).available) return [];
    return [Day.parse({ date, code, high, low })];
  });
  return { timezone, days };
}

export async function fetchForecast(location: z.infer<typeof Coordinates>, signal: AbortSignal): Promise<Forecast> {
  const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '16', temperature_unit: 'celsius' });
  // Leave models unset for Open-Meteo's default best match. No application API or analytics sees coordinates.
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error('Forecast request failed');
  return parseForecast(await response.json());
}
