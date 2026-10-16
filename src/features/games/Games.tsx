// Games: today first, then upcoming (mine first), then the last week's results.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { badgesChanged, useOnResume } from '@/lib/nav';
import { nyToday } from '@/lib/nyc';
import { load as loadRounds } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Game, GameTime, Member } from '@/schemas/group';
import { GameCard, type GameActions } from './GameCard';
import { phase } from './label';

export function Games({ focusId }: { focusId?: string }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(() => {
    Promise.all([api<Game[]>('/games'), api<Member>('/me')])
      .then(([g, m]) => { setGames(g); setMe(m); })
      .catch(() => toast.error("Couldn't load games"));
    api<Member[]>('/members').then(setMembers).catch(() => {});
  }, []);

  useEffect(load, [load]);
  useEffect(() => { void loadRounds(); }, []); // your own rounds, for "Resume my round"
  useOnResume(load);

  const today = nyToday();
  const live = !!games?.some((g) => phase(g, today) === 'today');
  // On round day the leaderboard moves; keep it fresh while the screen is open.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [live, load]);

  // A shared or notification link (#games/<id>) scrolls to its game.
  useEffect(() => {
    if (focusId && games) document.getElementById(`game-${focusId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusId, games]);

  const replace = (g: Game) => setGames((gs) => gs?.map((x) => (x.id === g.id ? g : x)) ?? null);

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
      toast('Game cancelled', { action: { label: 'Undo', onClick: () => void call(`/games/${game.id}`, { status: 'open' }).then(load) } });
    },
  };

  if (!games || !me) return <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>;

  const imIn = (g: Game) => g.players.some((p) => p.email === me.email && p.status === 'in');
  const of = (p: ReturnType<typeof phase>) => games.filter((g) => phase(g, today) === p);
  const upcoming = of('upcoming');
  const sections = [
    { title: 'Today', list: of('today') },
    { title: 'Coming up', list: [...upcoming.filter(imIn), ...upcoming.filter((g) => !imIn(g))] },
    { title: 'Recent', list: of('played').reverse() },
  ].filter((s) => s.list.length);

  return (
    <div className="space-y-4 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Games</h1>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Refresh" onClick={load}>
          <RefreshCw />
        </Button>
      </header>

      {!upcoming.length && !of('today').length && (
        <Card>
          <CardContent className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing planned. Find a tee time and tap the + person icon to get the group in.
            </p>
            <a href="#" className={cn(buttonVariants({ variant: 'default' }), 'min-h-11')}>Find tee times</a>
          </CardContent>
        </Card>
      )}

      {sections.map((s) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{s.title}</h2>
          {s.list.map((game) => (
            <GameCard key={game.id} game={game} phase={phase(game, today)} me={me} members={members} focused={focusId === game.id} actions={actions} />
          ))}
        </section>
      ))}
    </div>
  );
}
