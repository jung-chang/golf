// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

it('persists theme choice, follows system changes, and updates browser chrome', async () => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#2f7d4f">';
  let dark = false;
  let changed: (() => void) | undefined;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark; }, addEventListener: (_: string, fn: () => void) => { changed = fn; } }));
  const { setTheme } = await import('../src/lib/theme');
  expect(document.documentElement.dataset.theme).toBe('light');
  setTheme('dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('golf.theme')).toBe('dark');
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#0c1c13');
  setTheme('system');
  expect(document.documentElement.dataset.theme).toBe('light');
  dark = true;
  changed?.();
  expect(document.documentElement.dataset.theme).toBe('dark');
  setTheme('light');
  changed?.();
  expect(document.documentElement.dataset.theme).toBe('light');
  dispatchEvent(new StorageEvent('storage', { key: 'golf.theme', newValue: 'dark' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  vi.unstubAllGlobals();
});
