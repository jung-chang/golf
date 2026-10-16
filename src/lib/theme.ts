import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'golf.theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();
let preference: Theme = 'system';
try {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') preference = saved;
} catch { /* the system theme still works */ }
let resolved: 'light' | 'dark';
function apply() {
  resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0c1c13' : '#f8f6ee');
  listeners.forEach((l) => l());
}
apply();
media.addEventListener('change', apply);
addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  preference = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'system';
  apply();
});
export function setTheme(theme: Theme) {
  preference = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* applies for this visit */ }
  apply();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useTheme = () => useSyncExternalStore(subscribe, () => preference);
export const useResolvedTheme = () => useSyncExternalStore(subscribe, () => resolved);
