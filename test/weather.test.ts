import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cacheAge, condition, dateInZone, fetchForecast, forecastDay, FRESH_MS, MAX_CACHE_MS, parseForecast, temperature } from '../src/lib/weather';

const response = () => ({ timezone: 'Pacific/Auckland', daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C' }, daily: { time: ['2026-10-18', '2026-10-19'], weather_code: [0, 63], temperature_2m_max: [20, 18], temperature_2m_min: [10, 9] } });
describe('daily weather', () => {
  it('maps every documented WMO code to an existing, original static Flat asset', () => {
    const expected: Record<string, number[]> = {
      'clear-day': [0, 1], 'partly-cloudy-day': [2], overcast: [3], fog: [45, 48], drizzle: [51, 53, 55], sleet: [56, 57, 66, 67], rain: [61, 63, 65, 82], snow: [71, 73, 75, 77],
      'partly-cloudy-day-rain': [80, 81], 'partly-cloudy-day-snow': [85, 86], thunderstorms: [95, 97], 'thunderstorms-hail': [96, 99],
    };
    for (const [icon, codes] of Object.entries(expected)) {
      for (const code of codes) expect(condition(code)).toMatchObject({ icon, available: true });
      const svg = readFileSync(new URL(`../public/weather/${icon}.svg`, import.meta.url), 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).not.toMatch(/<animate|<set\s|<script|@keyframes/);
    }
    for (const unknown of [undefined, null, -1, 4, 100, NaN]) expect(condition(unknown)).toMatchObject({ icon: 'not-available', available: false });
    expect(readFileSync(new URL('../public/weather/LICENSE', import.meta.url), 'utf8')).toContain('Copyright (c) 2020-present Bas Milius');
  });
  it('converts only for display and handles freezing, negatives, rounding and missing values', () => {
    expect(temperature(0, 'fahrenheit')).toBe('32°');
    expect(temperature(20, 'fahrenheit')).toBe('68°');
    expect(temperature(-40, 'fahrenheit')).toBe('-40°');
    expect(temperature(20.6, 'celsius')).toBe('21°');
    expect(temperature(-0.1, 'celsius')).toBe('0°');
    expect(temperature(NaN, 'celsius')).toBe('—');
  });
  it('associates exact calendar dates in the forecast timezone across UTC midnight and DST', () => {
    const now = Date.parse('2026-10-17T23:30:00Z');
    expect(dateInZone('Pacific/Auckland', new Date(now))).toBe('2026-10-18');
    expect(dateInZone('America/Los_Angeles', new Date('2026-10-18T01:00:00Z'))).toBe('2026-10-17');
    expect(dateInZone('America/New_York', new Date('2026-11-01T04:30:00Z'))).toBe('2026-11-01');
    const cache = { fetchedAt: now, forecast: parseForecast(response()) };
    expect(forecastDay(cache, '2026-10-18', now)?.high).toBe(20);
    expect(forecastDay(cache, '2026-10-19', now)?.high).toBe(18);
    expect(forecastDay(cache, '2026-10-17', now)).toBeUndefined();
    expect(forecastDay(cache, '2026-11-01', now)).toBeUndefined();
    // Yesterday's cached prediction must not become invented historical weather.
    expect(forecastDay({ ...cache, fetchedAt: now + 86_400_000 }, '2026-10-18', now + 86_400_000)).toBeUndefined();
  });
  it('rejects malformed arrays, dates, timezone, units, and temperatures without coercion', () => {
    const cases = [
      {}, { ...response(), timezone: 'Invalid/Zone' }, { ...response(), daily_units: {} },
      { ...response(), daily: { ...response().daily, weather_code: [0] } },
      { ...response(), daily: { ...response().daily, time: ['2026-02-30', '2026-10-19'] } },
      { ...response(), daily: { ...response().daily, time: ['2026-10-18', '2026-10-18'] } },
      { ...response(), daily: { ...response().daily, temperature_2m_max: ['20', 18] } },
      { ...response(), daily: { ...response().daily, temperature_2m_max: [NaN, 18] } },
      { ...response(), daily: { ...response().daily, temperature_2m_min: [30, 9] } },
    ];
    for (const value of cases) expect(() => parseForecast(value)).toThrow();
    const missing = response(); missing.daily.temperature_2m_max[0] = null as unknown as number;
    expect(parseForecast(missing).days).toHaveLength(1);
    const unknown = response(); unknown.daily.weather_code[0] = 100;
    expect(parseForecast(unknown).days).toHaveLength(1);
  });
  it('expires caches at exact bounds and hides future timestamps', () => {
    const cache = { fetchedAt: 1000, forecast: parseForecast(response()) };
    expect(cacheAge(cache, 1000 + FRESH_MS - 1)).toBe('fresh');
    expect(cacheAge(cache, 1000 + FRESH_MS)).toBe('stale');
    expect(cacheAge(cache, 1000 + MAX_CACHE_MS)).toBe('expired');
    expect(cacheAge(cache, 999)).toBe('expired');
    expect(forecastDay(cache, '2026-10-18', 1000 + MAX_CACHE_MS)).toBeUndefined();
  });
  it('uses only daily Celsius fields, timezone=auto and default models; rejects HTTP failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response() });
    vi.stubGlobal('fetch', fetch);
    try {
      const controller = new AbortController();
      await fetchForecast({ latitude: 0, longitude: 0 }, controller.signal);
      const url = new URL(fetch.mock.calls[0][0]);
      expect(url.searchParams.get('daily')).toBe('weather_code,temperature_2m_max,temperature_2m_min');
      expect(url.searchParams.get('timezone')).toBe('auto');
      expect(url.searchParams.get('models')).toBeNull();
      expect(url.searchParams.get('temperature_unit')).toBe('celsius');
      expect(url.searchParams.get('forecast_days')).toBe('16');
      expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      fetch.mockResolvedValue({ ok: false });
      await expect(fetchForecast({ latitude: 0, longitude: 0 }, controller.signal)).rejects.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});
