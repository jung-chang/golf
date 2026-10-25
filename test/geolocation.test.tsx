// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bestFix, useGeolocation } from '../src/play/useGeolocation';
import { offset } from '../src/lib/geo';
import type { LngLat } from '../src/lib/geo';

const pos: LngLat = [-73.8, 40.7];
let success: PositionCallback, failure: PositionErrorCallback;
const clearWatch = vi.fn();
const watchPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => { success = ok; failure = fail!; return 7; });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } });
  watchPosition.mockClear(); clearWatch.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const position = (timestamp = Date.now(), point = pos) => ({ timestamp, coords: { longitude: point[0], latitude: point[1], accuracy: 3 } }) as GeolocationPosition;

it('discards stale precise positions instead of treating them as fresh', () => {
  expect(bestFix([{ pos, acc: 1, t: 90_000 }, { pos, acc: 5, t: 100_000 }], 100_000)?.acc).toBe(5);
  const far = offset(pos, 90, 30);
  expect(bestFix([{ pos, acc: 1, t: 99_000 }, { pos: far, acc: 3, t: 100_000 }], 100_000)?.pos).toEqual(far);
  expect(bestFix([{ pos, acc: 1, t: 100_001 }], 100_000)).toBeNull();
});
it('uses the sensor timestamp, expires a cached fix, and requires a fresh watch after resume', () => {
  const { result } = renderHook(useGeolocation);
  act(() => success(position(90_000))); expect(result.current.fix).toBeNull();
  act(() => success(position())); expect(result.current.fix?.t).toBe(100_000);
  act(() => vi.advanceTimersByTime(2500)); expect(result.current.settledMs).toBe(2500);
  act(() => vi.advanceTimersByTime(6000)); expect(result.current.fix).toBeNull();
  act(() => success(position())); expect(result.current.fix).not.toBeNull();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(result.current.fix).toBeNull();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(watchPosition).toHaveBeenCalledTimes(2);
  expect(result.current.fix).toBeNull();
  act(() => success(position()));
  act(() => failure({ message: 'denied' } as GeolocationPositionError));
  expect(result.current.fix).toBeNull(); expect(result.current.error).toBe('denied');
});
