// You: who you are, your golf (shot tracking lives here), notifications, and the group.
import { useEffect, useState } from 'react';
import { Backpack, Bell, ChartLine, Flag, LogOut, MapPin, Smartphone, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Group, Initials, PageHeader, Row } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { LoadError, SyncStatus } from '@/components/data-status';
import { SIGNED_OUT, api } from '@/lib/api';
import { handicapIndex, summarize } from '@/lib/stats';
import { load, useStore } from '@/lib/store';
import { setTheme, useTheme, type Theme } from '@/lib/theme';
import { courseByCode } from '@/lib/nyc';
import { disablePush, enablePush, needsInstall, pushEnabled, pushSupported } from '@/lib/push';
import type { Member, MemberUpdate } from '@/schemas/group';
import { HomeCourseSelect } from './HomeCourseSelect';
import { TemperatureToggle, WeatherCredit } from '@/components/daily-weather';
import { setTemperatureUnit, useWeather } from '@/lib/weather-store';

const errorText = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong';
const displayName = (m: Member) => m.name || m.email.split('@')[0];

export function Profile() {
  const weather = useWeather();
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const theme = useTheme();
  const supported = pushSupported();
  const rounds = useStore((s) => Object.values(s.rounds).filter((r) => r.done).length);
  const history = useStore((s) => s.rounds);
  const initialSynced = useStore((s) => s.initialSynced);
  const syncStatus = useStore((s) => s.syncStatus);
  const owner = useStore((s) => s.owner);

  // Apply a saved change to both you and the group list.
  const applied = (p: MemberUpdate) => {
    setMe((m) => m && { ...m, ...p });
    setMembers((ms) => ms?.map((x) => (x.email === me?.email ? { ...x, ...p } : x)) ?? null);
  };

  const save = async (p: MemberUpdate, ok?: string) => {
    try {
      await api('/me', { method: 'PUT', body: p });
      applied(p);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  };

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      try {
        const m = await api<Member>('/me');
        if (!alive) return;
        setMe(m);
        void load();
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    api<Member[]>('/members')
      .then((list) => alive && setMembers(list))
      .catch(() => alive && setError("Couldn't load the group. Try again."));
    pushEnabled().then((on) => alive && setPushOn(on)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    // Never publish an estimate from an empty or incomplete local cache on a new device.
    if (!me || owner !== me.email || !initialSynced || syncStatus !== 'synced') return;
    const est = handicapIndex(Object.values(history).filter((r) => r.done).map(summarize)
      .sort((a, b) => a.t - b.t).flatMap((s) => s.differential == null ? [] : [s.differential]));
    if (est === me.handicap) return;
    let alive = true;
    api<Member>('/me', { method: 'PUT', body: { handicap: est }, member: owner })
      .then((m) => { if (alive) { setMe(m); setMembers((ms) => ms?.map((x) => x.email === m.email ? m : x) ?? null); } })
      .catch(() => { /* keep the last verified estimate; retry after the next sync */ });
    return () => { alive = false; };
  }, [history, initialSynced, syncStatus, owner, me]);

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) await enablePush();
      else await disablePush();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setPushOn(await pushEnabled().catch(() => false));
      setPushBusy(false);
    }
  };

  const home = me?.homeCourse ? courseByCode(me.homeCourse) : undefined;

  return (
    <div className="pb-8">
      <PageHeader title="You" />
      {error && <LoadError message={error} retry={() => setAttempt((n) => n + 1)} />}

      <div className="space-y-6 px-4 pt-2">
        {/* You: tap to edit name and home course. */}
        {me ? (
          <button type="button" onClick={() => setEditing(true)} className="flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left active:bg-accent">
            <Initials name={displayName(me)} className="size-14 text-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-semibold">{me.name || 'Add your name'}</span>
              <span className="block truncate text-sm text-muted-foreground">{home ? `${home.name} regular` : me.email}</span>
            </span>
            <span className="text-sm font-medium text-primary">Edit</span>
          </button>
        ) : !error && <Skeleton className="h-[5.5rem] rounded-2xl" />}

        {me && (
          <div className="grid grid-cols-2 gap-3">
            <Stat href="#golf/trends" label="Handicap" value={me.handicap != null ? me.handicap.toFixed(1) : '–'} hint={me.handicap == null ? 'after 3 rounds' : undefined} />
            <Stat href="#golf" label="Rounds tracked" value={String(rounds)} />
          </div>
        )}

        <Group title="My golf">
          <Row icon={<Flag />} label="Start a round" sub="Choose a course and tees" href="#golf/start" />
          <Row icon={<Flag />} label="Rounds" sub="Scorecards and every shot" href="#golf" />
          <Row icon={<ChartLine />} label="Trends" sub="Scoring and how far each club goes" href="#golf/trends" />
          <Row icon={<Backpack />} label="My bag" sub="Your clubs and yardages" href="#golf/bag" />
          {me && me.handicap != null && (
            <Row label="Show my handicap to the group">
              <Switch checked={me.showHandicap} onCheckedChange={(v) => void save({ showHandicap: v })} aria-label="Show my handicap to the group" />
            </Row>
          )}
        </Group>

        <SyncStatus />

        <Group title="Appearance">
          <div className="space-y-2 p-4">
            <label htmlFor="app-theme" className="text-sm font-medium">Color theme</label>
            <select id="app-theme" className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base" value={theme} onChange={(e) => { const theme = e.target.value as Theme; setTheme(theme); void save({ theme }); }}>
              <option value="system">Follow phone setting</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
            <p className="text-sm text-muted-foreground">Choose the clearest view for the course.</p>
          </div>
        </Group>

        <Group title="Weather">
          <Row label="Temperature" sub={<WeatherCredit />}><TemperatureToggle weather={weather} onChange={(temperatureUnit) => { setTemperatureUnit(temperatureUnit); void save({ temperatureUnit }); }} /></Row>
        </Group>

        <Group title="Notifications">
          <Row icon={<Smartphone />} label="On this phone" sub={!supported ? (needsInstall() ? 'Add to Home Screen first (Share → Add to Home Screen)' : 'Not supported in this browser') : undefined}>
            <Switch checked={pushOn} disabled={!supported || pushBusy} onCheckedChange={(v) => void togglePush(v)} aria-label="Notifications on this phone" />
          </Row>
          {me && (
            <Row icon={<Bell />} label="New games and changes" sub="Proposals, who's in, bookings, round-day reminder">
              <Switch checked={me.notifyGames} onCheckedChange={(v) => void save({ notifyGames: v })} aria-label="Game updates" />
            </Row>
          )}
        </Group>

        <Group title={`The group${members ? ` · ${members.length}` : ''}`}>
          {members === null && !error && <div className="p-4"><Skeleton className="h-8" /></div>}
          {members?.map((m) => {
            const course = m.homeCourse ? courseByCode(m.homeCourse) : undefined;
            const isMe = m.email === me?.email;
            return (
              <Row
                key={m.email}
                icon={<Initials name={displayName(m)} className="size-8" />}
                label={<>{displayName(m)}{isMe && <span className="text-muted-foreground"> (you)</span>}</>}
                sub={course ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{course.name}</span> : undefined}
                value={m.handicap != null ? m.handicap.toFixed(1) : undefined}
              />
            );
          })}
        </Group>

        <Group>
          {me && <Row icon={<Users />} label="Signed in as" sub={me.email} />}
          {/* A real navigation: Cloudflare Access signs you out and shows its sign-in page. */}
          <Row icon={<LogOut />} label={<span className="text-flag">Sign out</span>} href="/cdn-cgi/access/logout" onClick={() => dispatchEvent(new Event(SIGNED_OUT))} />
        </Group>
      </div>

      {me && <EditProfile open={editing} onOpenChange={setEditing} me={me} onSave={(p) => save(p, 'Saved')} />}
    </div>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: string; hint?: string; href: string }) {
  return (
    <a href={href} className="block rounded-2xl border bg-card p-4 active:bg-accent">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </a>
  );
}

function EditProfile({ open, onOpenChange, me, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; me: Member; onSave: (p: MemberUpdate) => Promise<boolean>;
}) {
  const [name, setName] = useState(me.name);
  const [home, setHome] = useState(me.homeCourse);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(me.name); setHome(me.homeCourse); } }, [open, me]);

  const submit = async () => {
    setBusy(true);
    if (await onSave({ name: name.trim(), homeCourse: home })) onOpenChange(false);
    setBusy(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit profile</DrawerTitle>
          <DrawerDescription>The group sees your name and home course.</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4 px-5 pt-1">
          <div className="grid gap-2">
            <label htmlFor="profile-name" className="text-sm font-medium">Name</label>
            <Input id="profile-name" className="h-12 rounded-xl text-base" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="profile-course" className="text-sm font-medium">Home course</label>
            <HomeCourseSelect id="profile-course" value={home} onChange={setHome} />
          </div>
        </div>
        <DrawerFooter className="flex-row">
          <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button className="h-12 flex-[2] rounded-2xl text-base" onClick={submit} disabled={busy || !name.trim()}>Save</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
