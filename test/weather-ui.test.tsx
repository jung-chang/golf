// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { addDays, nyToday } from '../src/lib/nyc';
import { dayLabel } from '../src/features/games/label';

vi.mock('../src/lib/api', () => ({ api: async () => ({ email: 'golfer@example.test', name: 'Golfer' }), SIGNED_OUT: 'signed-out' }));
vi.mock('../src/lib/store', () => ({ useStore: () => false, load: async () => {}, sync: async () => {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('shows daily highs on date chips and switches units from settings, persisting them', async () => {
  const today = nyToday(), tomorrow = addDays(today, 1), missing = addDays(today, 2);
  localStorage.setItem('golf.weather.v1', JSON.stringify({ version: 1, cache: { fetchedAt: Date.now(), forecast: { timezone: 'America/New_York', days: [
    { date: today, code: 0, high: 20, low: 10 }, { date: tomorrow, code: 63, high: 15, low: 5 },
  ] } } }));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const { TeeTimes } = await import('../src/features/teetimes/TeeTimes');
  const { TemperatureToggle } = await import('../src/components/daily-weather');
  const { setTemperatureUnit, useWeather } = await import('../src/lib/weather-store');
  function Settings() { return <TemperatureToggle weather={useWeather()} onChange={setTemperatureUnit} />; }
  let view = render(<><TeeTimes view="search" alerts={0} /><Settings /></>);
  const date = (d: string) => screen.getByLabelText(dayLabel(d));
  const chip = (d: string) => date(d).parentElement!;
  expect(chip(today).textContent).toContain('68°');
  expect(date(tomorrow).getAttribute('aria-description')).toBe('Moderate rain, high 59°F');
  fireEvent.click(screen.getByRole('radio', { name: 'Celsius' }));
  expect(date(tomorrow).getAttribute('aria-description')).toBe('Moderate rain, high 15°C');
  expect(chip(today).textContent).toContain('20°');
  expect(JSON.parse(localStorage.getItem('golf.weather.v1')!).unit).toBe('celsius'); expect(fetch).not.toHaveBeenCalled();
  view.unmount(); view = render(<><TeeTimes view="search" alerts={0} /><Settings /></>);
  expect(screen.getByRole('radio', { name: 'Celsius' }).getAttribute('aria-checked')).toBe('true');
  expect(chip(missing).textContent).not.toMatch(/20°|15°/);
  expect(date(missing).getAttribute('aria-description')).toBeNull();
  await act(async () => {});
}, 15_000);

it('hides weather on date chips when the saved forecast has expired', async () => {
  const today = nyToday();
  localStorage.setItem('golf.weather.v1', JSON.stringify({ version: 1, cache: { fetchedAt: Date.now() - 25 * 60 * 60_000, forecast: { timezone: 'America/New_York', days: [
    { date: today, code: 0, high: 20, low: 10 },
  ] } } }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetModules();
  const { TeeTimes } = await import('../src/features/teetimes/TeeTimes');
  render(<TeeTimes view="search" alerts={0} />);
  const chip = screen.getByLabelText(dayLabel(today)).parentElement!;
  expect(chip.textContent).not.toMatch(/°|—/);
  expect(chip.querySelector('img')).toBeNull();
  await act(async () => {});
}, 15_000);
