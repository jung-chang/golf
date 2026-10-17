// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Member } from '../src/schemas/group';

const api = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../src/lib/api', () => ({ api }));
const member = (email: string, prefs: Partial<Member> = {}): Member =>
  ({ email, name: '', homeCourse: null, showHandicap: false, notifyGames: true, handicap: null, theme: null, temperatureUnit: null, ...prefs });

beforeEach(() => {
  vi.resetModules(); localStorage.clear(); api.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
async function load() {
  const theme = await import('../src/lib/theme'); const weather = await import('../src/lib/weather-store'); const { syncPrefs } = await import('../src/lib/prefs');
  return { theme, weather, syncPrefs };
}

it('applies the member\'s saved preferences over this device\'s', async () => {
  localStorage.setItem('golf.theme', 'light');
  const { theme, weather, syncPrefs } = await load();
  syncPrefs(member('a@x.com', { theme: 'dark', temperatureUnit: 'celsius' }));
  expect(theme.getTheme()).toBe('dark'); expect(weather.getTemperatureUnit()).toBe('celsius'); expect(api).not.toHaveBeenCalled();
});

it('uploads a member\'s earlier device choices once, the first time the server has none', async () => {
  localStorage.setItem('golf.theme', 'dark');
  const { theme, weather, syncPrefs } = await load();
  weather.setTemperatureUnit('celsius');
  syncPrefs(member('a@x.com'));
  expect(theme.getTheme()).toBe('dark');
  expect(api).toHaveBeenCalledWith('/me', { method: 'PUT', body: { theme: 'dark', temperatureUnit: 'celsius' } });
});

it('never hands one member\'s device choices to another member', async () => {
  localStorage.setItem('golf.theme', 'dark'); localStorage.setItem('golf.prefs.owner', 'a@x.com');
  const { theme, weather, syncPrefs } = await load();
  weather.setTemperatureUnit('celsius');
  syncPrefs(member('b@x.com'));
  expect(theme.getTheme()).toBe('system'); expect(weather.getTemperatureUnit()).toBe('fahrenheit'); expect(api).not.toHaveBeenCalled();
});
