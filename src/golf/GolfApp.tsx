// Shot tracking: opens from a game on round day ("Start my round"), or at #golf.
import { lazy, Suspense, useEffect } from 'react';
import { load, useStore } from '../lib/store';
import { Courses } from '../views/Courses';
import { Rounds, RoundDetail } from '../views/Rounds';
import { Progress } from '../views/Progress';
import { BagView } from '../views/Bag';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'uplot/dist/uPlot.min.css';
import './golf.css';

// The map (MapLibre, ~1 MB) only loads when you open a round.
const Play = lazy(() => import('../play/Play').then((m) => ({ default: m.Play })));

const TABS = [['golf', 'Courses'], ['golf/play', 'Play'], ['golf/rounds', 'Rounds'], ['golf/progress', 'Progress'], ['golf/bag', 'Bag']] as const;

export default function GolfApp({ page, arg }: { page?: string; arg?: string }) {
  const loaded = useStore((s) => s.loaded);
  const activeId = useStore((s) => s.activeId);
  useEffect(() => { void load(); }, []);

  let screen;
  if (!loaded) screen = null;
  else if (page === 'play') screen = activeId ? <Play key={activeId} roundId={activeId} /> : <Courses />;
  else if (page === 'rounds') screen = <Rounds />;
  else if (page === 'round') screen = <RoundDetail id={arg ?? ''} />;
  else if (page === 'progress') screen = <Progress />;
  else if (page === 'bag') screen = <BagView />;
  else screen = <Courses />;

  const current = page === 'round' ? 'golf/rounds' : page ? `golf/${page}` : 'golf';
  return (
    <div className="legacy">
      <main className={page === 'play' ? 'full' : ''}><Suspense>{screen}</Suspense></main>
      <nav>
        <a href="#games" className="back" aria-label="Back to the group">‹ Group</a>
        {TABS.filter(([id]) => id !== 'golf/play' || activeId).map(([id, label]) => (
          <a key={id} href={`#${id}`} className={current === id ? 'on' : ''}>{label}</a>
        ))}
      </nav>
    </div>
  );
}
