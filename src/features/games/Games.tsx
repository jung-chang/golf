// Games: Upcoming (today first, then the ones you're in) and Past (results). Tap one for the whole game.
import { useCallback, useEffect, useState } from 'react';
import { CalendarSearch, History, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Empty, IconAction, PageHeader } from '@/components/page';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { badgesChanged, closeSheet, openSheet, useOnResume } from '@/lib/nav';
import { nyToday } from '@/lib/nyc';
import { load as loadRounds } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Game, GameTime, Member } from '@/schemas/group';
import { GameRow, GameSheet, type GameActions } from './GameSheet';
import { phase } from './label';

export function Games({ focusId }: { focusId?: string }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [past, setPast] = useState<Game[] | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(() => {
    Promise.all([api<Game[]>('/games'), api<Member>('/me')])
      .then(([g, m]) => { setGames(g); setMe(m); })
      .catch(() => toast.error("Couldn't load games"));
    api<Member[]>('/members').then(setMembers).catch(() => {});
  }, []);
  const loadPast = useCallback(() => {
    api<Game[]>('/games?past=1').then((g) => setPast(g.reverse())).catch(() => toast.error("Couldn't load past games"));
  }, []);

  useEffect(load, [load]);
  useEffect(() => { void loadRounds(); }, []); // your own rounds, for "Resume my round"
  useOnResume(load);
  useEffect(() => { if (tab === 'past' && !past) loadPast(); }, [tab, past, loadPast]);

  const today = nyToday();
  const live = !!games?.some((g) => phase(g, today) === 'today');
  // On round day the leaderboard moves; keep it fresh while the screen is open.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [live, load]);

  // A link to an older game (#games/<id>) than the list holds: look in the past ones.
  const focused = focusId ? games?.find((g) => g.id === focusId) ?? past?.find((g) => g.id === focusId) : undefined;
  useEffect(() => { if (focusId && games && !focused && !past) loadPast(); }, [focusId, games, focused, past, loadPast]);

  const replace = (g: Game) => {
    setGames((gs) => gs?.map((x) => (x.id === g.id ? g : x)) ?? null);
    setPast((gs) => gs?.map((x) => (x.id === g.id ? g : x)) ?? null);
  };

  const call = async (path: string, body: unknown, method = 'PUT') => {
    try {
      const g = await api<Game>(path, { method, body });
      if (g.status === 'cancelled') setGames((gs) => gs?.filter((x) => x.id !== g.id) ?? null);
      else replace(g);
      badgesChanged();
      return g;
    } catch {
      toast.error("Couldn't save");
    }
  };

  const actions: GameActions = {
    rsvp: (game, status) => void call(`/games/${game.id}/rsvp`, { status }),
    book: (game: Game, t: GameTime, booked: boolean) => void call(`/games/${game.id}/book`, { teetime: t.teetime, booked }),
    checkIn: async (game) => !!(await call(`/games/${game.id}/checkin`, {})),
    cancel: async (game) => {
      if (!(await call(`/games/${game.id}`, { status: 'cancelled' }))) return;
      closeSheet('games');
      toast('Game cancelled', { action: { label: 'Undo', onClick: () => void call(`/games/${game.id}`, { status: 'open' }).then(load) } });
    },
  };

  const imIn = (g: Game) => !!me && g.players.some((p) => p.email === me.email && p.status === 'in');
  const of = (p: ReturnType<typeof phase>) => (games ?? []).filter((g) => phase(g, today) === p);
  const upcoming = of('upcoming');
  const sections = [
    { title: 'Today', list: of('today') },
    { title: 'Coming up', list: [...upcoming.filter(imIn), ...upcoming.filter((g) => !imIn(g))] },
  ].filter((s) => s.list.length);
  const pastList = past ?? [];
  const findButton = <a href="#" className={cn(buttonVariants(), 'min-h-11 rounded-full px-5')}>Find a tee time</a>;

  return (
    <div className="pb-8">
      <PageHeader title="Games" actions={<IconAction label="Refresh" onClick={() => (tab === 'past' ? loadPast() : load())}><RefreshCw className="size-5" /></IconAction>} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="px-4 pt-1">
        <TabsList className="h-10 w-full rounded-full">
          <TabsTrigger value="upcoming" className="rounded-full">Upcoming</TabsTrigger>
          <TabsTrigger value="past" className="rounded-full">Past</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-5 px-4 pt-4">
        {tab === 'upcoming' && (
          !games || !me ? <ListSkeleton /> : sections.length === 0 ? (
            <Empty icon={<CalendarSearch />} title="Nothing planned" action={findButton}>
              Find a tee time and propose it. Everyone gets a ping to say they're in.
            </Empty>
          ) : sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.title}</h2>
              {s.list.map((g) => <GameRow key={g.id} game={g} phase={phase(g, today)} me={me} onOpen={() => openSheet(`games/${g.id}`)} />)}
            </section>
          ))
        )}

        {tab === 'past' && (
          !past || !me ? <ListSkeleton /> : pastList.length === 0 ? (
            <Empty icon={<History />} title="No games played yet">Results and leaderboards land here after each round.</Empty>
          ) : (
            <section className="space-y-2">
              {pastList.map((g) => <GameRow key={g.id} game={g} phase="played" me={me} onOpen={() => openSheet(`games/${g.id}`)} />)}
            </section>
          )
        )}
      </div>

      {me && (
        <GameSheet game={focused} phase={focused ? phase(focused, today) : 'upcoming'} me={me} members={members} actions={actions} onClose={() => closeSheet('games')} />
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.75rem] rounded-2xl" />)}
    </div>
  );
}
