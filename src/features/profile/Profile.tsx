import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { handicapIndex, summarize } from '@/lib/stats';
import { load, getState } from '@/lib/store';
import { courseByCode } from '@/lib/nyc';
import { disablePush, enablePush, pushEnabled, pushSupported } from '@/lib/push';
import type { Member, MemberUpdate } from '@/schemas/group';
import { HomeCourseSelect } from './HomeCourseSelect';

const errorText = (e: unknown) => (e instanceof Error && e.message) || 'Something went wrong';

export function Profile() {
  const [me, setMe] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const supported = pushSupported();

  // Apply a saved change to both the "You" card and the group list.
  const applied = (p: MemberUpdate) => {
    setMe((m) => m && { ...m, ...p });
    setMembers((ms) => ms?.map((x) => (x.email === me?.email ? { ...x, ...p } : x)) ?? null);
  };

  const save = async (p: MemberUpdate, ok?: string) => {
    try {
      await api('/me', { method: 'PUT', body: p });
      applied(p);
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await api<Member>('/me');
        if (!alive) return;
        setMe(m);
        setName(m.name);
        // Handicap estimate from shot tracking; quietly store it if it changed.
        await load();
        const diffs = Object.values(getState().rounds)
          .map(summarize)
          .sort((a, b) => a.t - b.t)
          .flatMap((s) => (s.differential == null ? [] : [s.differential]));
        const est = handicapIndex(diffs);
        if (est !== m.handicap && alive) {
          await api('/me', { method: 'PUT', body: { handicap: est } });
          if (alive) setMe((cur) => cur && { ...cur, handicap: est });
        }
      } catch (e) {
        if (alive) toast.error(errorText(e));
      }
    })();
    api<Member[]>('/members')
      .then((list) => alive && setMembers(list))
      .catch(() => alive && toast.error("Couldn't load the group"));
    pushEnabled().then((on) => alive && setPushOn(on)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  const saveName = () => {
    const v = name.trim();
    setName(v);
    if (me && v !== me.name) void save({ name: v }, 'Saved');
  };

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pt-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">Profile</h1>
        {me && (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            Signed in as {me.email}
            <a href="/cdn-cgi/access/logout" className="inline-flex min-h-11 items-center underline underline-offset-4">Sign out</a>
          </p>
        )}
      </header>

      {me && (
        <Card className="gap-4 rounded-xl py-4">
          <div className="space-y-4 px-4">
            <h2 className="text-sm font-medium text-muted-foreground">You</h2>

            <div className="space-y-2">
              <label htmlFor="profile-name" className="text-sm font-medium">Name</label>
              <Input
                id="profile-name"
                className="h-11 text-base"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="profile-course" className="text-sm font-medium">Home course</label>
              <HomeCourseSelect id="profile-course" value={me.homeCourse} onChange={(code) => void save({ homeCourse: code }, 'Saved')} />
            </div>

            {/* Only once shot tracking has rounds to estimate from. */}
            {me.handicap != null && (
            <>
            <div className="flex min-h-11 items-center justify-between">
              <span className="text-sm font-medium">Handicap estimate</span>
              <span className="text-base tabular-nums">{me.handicap.toFixed(1)}</span>
            </div>

            <label htmlFor="profile-show-hcp" className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span className="text-sm font-medium">Show my handicap to the group</span>
              <Switch
                id="profile-show-hcp"
                checked={me.showHandicap}
                onCheckedChange={(v) => void save({ showHandicap: v })}
              />
            </label>
            </>
            )}
          </div>
        </Card>
      )}

      {me && (
        <Card className="gap-4 rounded-xl py-4">
          <div className="space-y-4 px-4">
            <h2 className="text-sm font-medium text-muted-foreground">Notifications</h2>

            <label htmlFor="profile-notify" className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
              <span className="text-sm font-medium">Game updates</span>
              <Switch
                id="profile-notify"
                checked={me.notifyGames}
                onCheckedChange={(v) => void save({ notifyGames: v })}
              />
            </label>

            <div>
              <label htmlFor="profile-push" className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="text-sm font-medium">Notifications on this phone</span>
                <Switch
                  id="profile-push"
                  checked={pushOn}
                  disabled={!supported || pushBusy}
                  onCheckedChange={(v) => void togglePush(v)}
                />
              </label>
              {!supported && (
                <p className="text-sm text-muted-foreground">On iPhone, add this app to your Home Screen first.</p>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card className="gap-4 rounded-xl py-4">
        <div className="space-y-2 px-4">
          <h2 className="text-sm font-medium text-muted-foreground">Group</h2>
          {members === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {members?.map((m) => {
            const isMe = m.email === me?.email;
            const local = m.email.split('@')[0];
            const course = m.homeCourse ? courseByCode(m.homeCourse) : undefined;
            return (
              <div key={m.email} className="flex min-h-11 items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className={m.name ? 'font-medium' : 'text-muted-foreground'}>{m.name || local}</span>
                  {isMe && <span className="ml-1 text-sm text-muted-foreground">(you)</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {course && <Badge variant="secondary">{course.code}</Badge>}
                  {m.handicap != null && <span className="text-sm tabular-nums">{m.handicap.toFixed(1)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <footer className="pt-2 text-center">
        <a href="#golf" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4">
          My rounds &amp; stats
        </a>
      </footer>
    </div>
  );
}
