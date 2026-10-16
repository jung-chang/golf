// Shot tracking, loaded only when opened. My golf and a round's scorecard sit inside the app (You tab);
// Play takes the whole screen.
import { lazy, Suspense, useEffect } from 'react';
import { go } from '@/lib/nav';
import { load, useStore } from '@/lib/store';
import { MyGolf, type GolfTab } from './MyGolf';
import { RoundDetail } from './RoundDetail';

// The map (MapLibre, ~1 MB) only loads when you play.
const Play = lazy(() => import('../play/Play').then((m) => ({ default: m.Play })));

export default function Golf({ page, arg }: { page?: string; arg?: string }) {
  const loaded = useStore((s) => s.loaded);
  useEffect(() => { void load(); }, []);
  if (!loaded) return null;
  if (page === 'round') return <RoundDetail id={arg ?? ''} />;
  const tab: GolfTab = page === 'trends' || page === 'progress' ? 'trends' : page === 'bag' ? 'bag' : 'rounds';
  return <MyGolf tab={tab} />;
}

/** Full screen: the round in progress, or back to My golf if there isn't one. */
export function PlayScreen() {
  const loaded = useStore((s) => s.loaded);
  const activeId = useStore((s) => s.activeId);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (loaded && !activeId) go('golf'); }, [loaded, activeId]);
  if (!loaded || !activeId) return null;
  return <Suspense><Play key={activeId} roundId={activeId} /></Suspense>;
}
