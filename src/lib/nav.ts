import { useEffect, useState } from 'react';

// Screens live in the URL hash (#games, #golf/round/<id>) so the phone's back button works.
export function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Screens fire this after a change that moves a tab badge (an RSVP, opening an alert). */
export const BADGES_CHANGED = 'golf:badges';
export const badgesChanged = () => dispatchEvent(new Event(BADGES_CHANGED));

export const go = (hash: string) => { location.hash = hash; };

/** Open a sheet that has its own URL (#games/<id>), so the phone's back button closes it. */
export function openSheet(hash: string) {
  history.pushState({ sheet: true }, '', `#${hash}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Close it: step back if we opened it, else (arrived by link) go to the screen underneath. */
export function closeSheet(parent: string) {
  if ((history.state as { sheet?: boolean } | null)?.sheet) history.back();
  else go(parent);
}

/** Calls `fn` whenever the app comes back to the foreground (window focus is unreliable in an iPhone home-screen app). */
export function useOnResume(fn: () => void) {
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') fn(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [fn]);
}
