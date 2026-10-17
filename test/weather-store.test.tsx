// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';
import { FRESH_MS } from '../src/lib/weather';

const KEY = 'golf.weather.v1';
const payload = (high = 20) => ({ timezone: 'UTC', daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C' }, daily: { time: ['2026-10-17'], weather_code: [0], temperature_2m_max: [high], temperature_2m_min: [10] } });
let handlers: [string, EventListenerOrEventListenerObject][];
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  handlers = [];
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler, options) => { handlers.push([type, handler]); original(type, handler, options); });
});
afterEach(() => { cleanup(); for (const [type, handler] of handlers) window.removeEventListener(type, handler); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const success = (high = 20) => ({ ok: true, json: async () => payload(high) });

it('fetches the NYC forecast on first use and persists units independently of the forecast', async () => {
  const fetch = vi.fn().mockResolvedValue(success()); vi.stubGlobal('fetch', fetch);
  const store = await import('../src/lib/weather-store');
  const { result } = renderHook(store.useWeather);
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toContain('latitude=40.73&longitude=-73.94');
  expect(result.current.unit).toBe('fahrenheit'); expect(result.current.cache?.forecast.days[0].high).toBe(20);
  act(() => store.setTemperatureUnit('celsius'));
  expect(JSON.parse(localStorage.getItem(KEY)!).unit).toBe('celsius'); expect(fetch).toHaveBeenCalledTimes(1);
  vi.resetModules();
  const reload = await import('../src/lib/weather-store');
  const again = renderHook(reload.useWeather).result;
  await act(async () => {});
  expect(again.current.unit).toBe('celsius'); expect(again.current.cache?.forecast.days[0].high).toBe(20); expect(fetch).toHaveBeenCalledTimes(1);
});
it('deduplicates requests, refetches after the cache goes stale and keeps the old forecast on failure', async () => {
  const fetch = vi.fn().mockResolvedValue(success()); vi.stubGlobal('fetch', fetch);
  const store = await import('../src/lib/weather-store'); const { result } = renderHook(store.useWeather);
  await act(async () => { await Promise.all([store.refreshWeather(), store.refreshWeather()]); });
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockRejectedValue(new Error('network'));
  await act(async () => { vi.advanceTimersByTime(FRESH_MS); await store.refreshWeather(); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(result.current.cache?.forecast.days[0].high).toBe(20); expect(result.current.busy).toBe(false);
});
it('skips fetching offline and survives blocked storage', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const store = await import('../src/lib/weather-store'); const { result } = renderHook(store.useWeather);
  await act(async () => {}); expect(fetch).not.toHaveBeenCalled();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  act(() => store.setTemperatureUnit('celsius')); expect(result.current.unit).toBe('celsius');
});
