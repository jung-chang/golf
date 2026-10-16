import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { CalendarSearch, ChevronRight, Flag, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { ACCOUNT_CHANGED, SIGNED_OUT, api } from '@/lib/api';
import { LoadingScreen } from '@/components/data-status';
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

// Shot tracking loads only when opened: My golf inside the app, Play full screen.
const Golf = lazy(() => import('./golf/GolfApp'));
const PlayScreen = lazy(() => import('./golf/GolfApp').then((m) => ({ default: m.PlayScreen })));

// Three places: find a time (alerts are saved searches, so they live here), the group's games, and you.
const TABS = [
  { id: '', label: 'Tee times', icon: CalendarSearch, pages: ['', 'results', 'alerts'] },
  { id: 'games', label: 'Games', icon: Users, pages: ['games'] },
  { id: 'profile', label: 'You', icon: UserRound, pages: ['profile', 'golf'] },
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
function UpNext({ today, page }: { today: Badges['today']; page: string }) {
  useEffect(() => { void loadRounds(); }, []);
  const round = useStore((s) => (s.activeId ? s.rounds[s.activeId] : undefined));
  const cls = 'mx-3 mt-2 flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-medium shadow-sm active:opacity-90';
  if (round && !round.done && page !== 'golf') { // My golf leads with the round in progress
    const thru = playedHoles(round).length;
    return (
      <a href="#golf/play" className={cn(cls, 'bg-orange text-orange-foreground')}>
        <Flag className="size-4" /> Round in progress · {round.courseName.replace(/ Golf Course$/, '')}
        {thru > 0 && ` · ${fmtToPar(toPar(round))} thru ${thru}`}
        <span className="ml-auto flex items-center">Resume <ChevronRight className="size-4" /></span>
      </a>
    );
  }
  if (!today || page === 'games') return null; // the Games screen already leads with today's game
  return (
    <a href={`#games/${today.id}`} className={cn(cls, 'bg-primary text-primary-foreground')}>
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
  const [accountChanged, setAccountChanged] = useState(false);
  useEffect(() => {
    const on = () => setAccountChanged(true);
    addEventListener(ACCOUNT_CHANGED, on);
    return () => removeEventListener(ACCOUNT_CHANGED, on);
  }, []);
  if (accountChanged) return <div className="mx-auto max-w-lg space-y-4 p-6"><h1 className="text-xl font-bold">Your account changed</h1><p>Reload to open the current account's data.</p><Button className="min-h-12" onClick={() => location.reload()}>Reload app</Button></div>;

  if (page === 'golf' && rest[0] === 'play') {
    return <><Suspense fallback={<LoadingScreen />}><PlayScreen /></Suspense>{signedOut && <div className="fixed inset-x-0 top-0 z-50 bg-background p-4"><a href="/api/login" className="font-semibold underline">Sign in again to continue</a></div>}<Toaster position="top-center" /></>;
  }

  let screen;
  if (page === 'golf') screen = <Suspense fallback={<LoadingScreen />}><Golf page={rest[0]} arg={rest[1]} /></Suspense>;
  else if (page === 'games') screen = <Games focusId={rest[0]} />;
  else if (page === 'alerts') screen = <Alerts focusId={rest[0]} />;
  else if (page === 'profile') screen = <Profile />;
  else screen = <TeeTimes view={page === 'results' ? 'results' : 'search'} alerts={badges.alerts} />;

  const current = TABS.find((t) => (t.pages as readonly string[]).includes(page))?.id ?? '';
  const count = (id: string) => (id === 'games' ? badges.games : id === '' ? badges.alerts : 0);
  return (
    <div className="flex h-dvh flex-col">
      {signedOut && (
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-sm">
          <span>Your sign-in expired.</span>
          {/* A real navigation (not the cached app) so Cloudflare Access can show its sign-in page. */}
          <Button asChild size="sm" className="min-h-11"><a href="/api/login">Sign in again</a></Button>
        </div>
      )}
      {!signedOut && <div className="pt-[env(safe-area-inset-top)]"><UpNext today={badges.today} page={page} /></div>}
      <main className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto h-full max-w-lg">{screen}</div></main>
      <nav className="flex border-t bg-background/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {TABS.map(({ id, label, icon: Icon }) => {
          const n = count(id);
          const on = current === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={on ? 'page' : undefined}
              className={cn('flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[0.6875rem] font-medium text-muted-foreground', on && 'text-foreground')}
            >
              <span className={cn('relative grid h-8 w-14 place-content-center rounded-full transition-colors', on && 'bg-accent text-accent-foreground')}>
                <Icon className="size-5" strokeWidth={on ? 2.25 : 1.75} />
                {n > 0 && (
                  <span className="absolute -top-0.5 right-2 min-w-4 rounded-full bg-orange px-1 text-center text-[0.625rem] leading-4 font-bold text-orange-foreground tabular-nums ring-2 ring-background">
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
