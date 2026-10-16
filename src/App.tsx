import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Bell, CalendarSearch, ChevronRight, Flag, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { SIGNED_OUT, api } from '@/lib/api';
import { BADGES_CHANGED, useHash, useOnResume } from '@/lib/nav';
import { TeeTimes } from '@/features/teetimes/TeeTimes';
import { Games } from '@/features/games/Games';
import { Alerts } from '@/features/alerts/Alerts';
import { Profile } from '@/features/profile/Profile';
import { Welcome } from '@/features/profile/Welcome';
import { BookingCheck } from '@/features/games/BookingCheck';
import { countdown } from '@/features/games/label';
import { fmtToPar, playedHoles, toPar } from '@/lib/round';
import { load as loadRounds, useStore } from '@/lib/store';
import { fmtMinutes, toMinutes } from '@/lib/teetimes';

// Shot tracking is hidden for now (#golf); it loads only when opened.
const GolfApp = lazy(() => import('./golf/GolfApp'));

const TABS = [
  { id: '', label: 'Tee times', icon: CalendarSearch },
  { id: 'games', label: 'Games', icon: Users },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'profile', label: 'Profile', icon: User },
] as const;

type Badges = { games: number; alerts: number; today: { id: string; code: string; teetime: string } | null };

/** Counts for the tab bar; refreshed on every screen change and when the app comes back. */
function useBadges(page: string) {
  const [badges, setBadges] = useState<Badges>({ games: 0, alerts: 0, today: null });
  const load = useCallback(() => { api<Badges>('/badges').then(setBadges).catch(() => {}); }, []);
  useEffect(load, [load, page]);
  useEffect(() => {
    addEventListener(BADGES_CHANGED, load);
    return () => removeEventListener(BADGES_CHANGED, load);
  }, [load]);
  useOnResume(load);
  return badges;
}

const nyTime = (iso: string) => fmtMinutes(toMinutes(new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })));

/** One line above every screen on round day: resume the round in progress, or go to today's game. */
function UpNext({ today, onGames }: { today: Badges['today']; onGames: boolean }) {
  useEffect(() => { void loadRounds(); }, []);
  const round = useStore((s) => (s.activeId ? s.rounds[s.activeId] : undefined));
  const cls = 'flex min-h-11 items-center gap-2 bg-primary px-4 text-sm font-medium text-primary-foreground';
  if (round && !round.done) {
    const thru = playedHoles(round).length;
    return (
      <a href="#golf/play" className={cls}>
        <Flag className="size-4" /> Round in progress · {round.courseName.replace(/ Golf Course$/, '')}
        {thru > 0 && ` · ${fmtToPar(toPar(round))} thru ${thru}`}
        <span className="ml-auto flex items-center">Resume <ChevronRight className="size-4" /></span>
      </a>
    );
  }
  if (!today || onGames) return null; // the Games screen already leads with today's game
  return (
    <a href={`#games/${today.id}`} className={cls}>
      <Flag className="size-4" /> Today · {today.code} {nyTime(today.teetime)} · {countdown(today.teetime)}
      <ChevronRight className="ml-auto size-4" />
    </a>
  );
}

function useSignedOut() {
  const [out, setOut] = useState(false);
  useEffect(() => {
    const on = () => setOut(true);
    addEventListener(SIGNED_OUT, on);
    return () => removeEventListener(SIGNED_OUT, on);
  }, []);
  return out;
}

export function App() {
  const [page, ...rest] = useHash().split('/');
  const badges = useBadges(page);
  const signedOut = useSignedOut();

  if (page === 'golf') {
    return <Suspense><GolfApp page={rest[0]} arg={rest[1]} /></Suspense>;
  }

  let screen;
  if (page === 'games') screen = <Games focusId={rest[0]} />;
  else if (page === 'alerts') screen = <Alerts focusId={rest[0]} />;
  else if (page === 'profile') screen = <Profile />;
  else screen = <TeeTimes view={page === 'results' ? 'results' : 'search'} />;

  const current = page === 'results' ? '' : page;
  const count = (id: string) => (id === 'games' ? badges.games : id === 'alerts' ? badges.alerts : 0);
  return (
    <div className="flex h-dvh flex-col">
      {signedOut && (
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-sm">
          <span>Your sign-in expired.</span>
          {/* A real navigation (not the cached app) so Cloudflare Access can show its sign-in page. */}
          <Button asChild size="sm" className="min-h-11"><a href="/api/login">Sign in again</a></Button>
        </div>
      )}
      {!signedOut && <div className="pt-[env(safe-area-inset-top)]"><UpNext today={badges.today} onGames={page === 'games'} /></div>}
      <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto h-full max-w-lg">{screen}</div></main>
      <nav className="flex border-t bg-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const n = count(id);
          return (
            <a
              key={id}
              href={`#${id}`}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-muted-foreground',
                current === id && 'text-primary',
              )}
            >
              <span className="relative">
                <Icon className="size-5" />
                {n > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-flag px-1 text-center text-[0.625rem] leading-4 font-semibold text-white tabular-nums">
                    {n > 9 ? '9+' : n}
                  </span>
                )}
              </span>
              {label}
              {n > 0 && <span className="sr-only">({n} new)</span>}
            </a>
          );
        })}
      </nav>
      <Welcome />
      <BookingCheck />
      {/* Signed out, every call fails; the banner says why, so their error toasts would only cover it. */}
      {!signedOut && <Toaster position="top-center" />}
    </div>
  );
}
