// The Alerts tab: your alerts, paused or active, with their current matches.
import { useCallback, useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { badgesChanged, useOnResume } from '@/lib/nav';
import { enablePush, pushEnabled, pushSupported } from '@/lib/push';
import { daysOut } from '@/lib/nyc';
import { timeKey, type TeeTime } from '@/schemas/teetimes';
import type { Alert } from '@/schemas/group';
import { AlertSetupDialog } from './AlertSetupDialog';
import { dateLabel, everyLabel, holesLabel, repeatLabel, TimeRow, windowLabel } from './shared';

type Matches = { fresh: TeeTime[]; seen: TeeTime[] };
type PushState = 'off' | 'on' | 'unsupported';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

function AlertSummary({ alert }: { alert: Alert }) {
  const { criteria, weekdays, unread } = alert;
  const expired = !weekdays.length && criteria.dates.every((d) => daysOut(d) < 0);
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 font-medium">
        {weekdays.length > 0 && <span>{repeatLabel(weekdays)}</span>}
        {!weekdays.length && criteria.dates.map((d) => (
          <span key={d} className={daysOut(d) < 0 ? 'text-muted-foreground line-through' : undefined}>{dateLabel(d)}</span>
        ))}
        {unread.length > 0 && <span className="rounded-md bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">{unread.length} new</span>}
        {expired && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-normal text-secondary-foreground">Expired</span>}
      </div>
      <div className="text-muted-foreground">{criteria.codes.join(', ')} · {windowLabel(criteria.window)}</div>
    </div>
  );
}

export function Alerts({ focusId }: { focusId?: string }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>(() => (pushSupported() ? 'off' : 'unsupported'));
  const [openId, setOpenId] = useState<string | undefined>(focusId);
  const [matches, setMatches] = useState<Record<string, Matches | 'error' | 'loading'>>({});
  const [editing, setEditing] = useState<Alert | null>(null);
  const [showAll, setShowAll] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<Alert[]>('/alerts').then(setAlerts).catch((e) => setError(errorText(e)));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useOnResume(reload);

  useEffect(() => {
    if (push === 'unsupported') return;
    pushEnabled().then((on) => setPush(on ? 'on' : 'off')).catch(() => {});
  }, [push]);

  // A notification link opens its alert.
  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    document.getElementById(`alert-${focusId}`)?.scrollIntoView({ block: 'start' });
  }, [focusId, alerts]);

  // Matches load each time a card opens (live, not cached).
  const loadMatches = useCallback((id: string) => {
    setMatches((m) => ({ ...m, [id]: 'loading' }));
    api<Matches>(`/alerts/${id}/matches?force=1`)
      .then((r) => setMatches((m) => ({ ...m, [id]: r })))
      .catch(() => setMatches((m) => ({ ...m, [id]: 'error' })));
  }, []);

  useEffect(() => {
    if (openId) loadMatches(openId);
  }, [openId, loadMatches]);

  // Opening an alert counts its new times as read (they stay labelled "New" until the card closes).
  const openAlert = alerts?.find((a) => a.id === openId);
  const unreadCount = openAlert?.unread.length ?? 0;
  useEffect(() => {
    if (!openId || !unreadCount) return;
    api(`/alerts/${openId}`, { method: 'PUT', body: { read: true } })
      .then(() => {
        setAlerts((list) => list?.map((a) => (a.id === openId ? { ...a, unread: [] } : a)) ?? null);
        badgesChanged();
      })
      .catch(() => {});
  }, [openId, unreadCount]);

  const turnOn = async () => {
    try {
      await enablePush();
      setPush('on');
      toast.success('Notifications are on');
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const setPaused = async (alert: Alert, paused: boolean) => {
    setAlerts((list) => list?.map((a) => (a.id === alert.id ? { ...a, paused } : a)) ?? null);
    try {
      await api(`/alerts/${alert.id}`, { method: 'PUT', body: { paused } });
    } catch (e) {
      toast.error(errorText(e));
      reload();
    }
  };

  const remove = async (alert: Alert) => {
    try {
      await api(`/alerts/${alert.id}`, { method: 'DELETE' });
      setAlerts((list) => list?.filter((a) => a.id !== alert.id) ?? null);
      badgesChanged();
    } catch (e) {
      toast.error(errorText(e));
      return;
    }
    // Undo puts it back as a new alert with the same criteria and history.
    toast('Alert deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          api<Alert>('/alerts', { body: { criteria: alert.criteria, seen: alert.seen, weekdays: alert.weekdays, every: alert.every } })
            .then((a) => (alert.paused ? api(`/alerts/${a.id}`, { method: 'PUT', body: { paused: true } }) : a))
            .then(reload)
            .catch((e) => toast.error(errorText(e)));
        },
      },
    });
  };

  return (
    <div className="grid gap-4 px-4 pt-6 pb-10">
      <h1 className="text-2xl font-semibold">Alerts</h1>
      {push === 'unsupported' && (
        <Card className="gap-0 py-0">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p>On iPhone, add this app to your Home Screen to get notifications.</p>
          </CardContent>
        </Card>
      )}
      {push === 'off' && (
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">Turn on notifications to get alerts</p>
            <Button className="min-h-11" onClick={turnOn}>Turn on</Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!alerts && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {alerts?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No alerts yet. Search tee times, then tap the bell to get notified when new ones open.
        </p>
      )}

      {alerts?.map((alert) => {
        const open = openId === alert.id;
        const m = matches[alert.id];
        return (
          <Card key={alert.id} id={`alert-${alert.id}`} className="gap-0 py-0">
            <div className={`flex items-center gap-2 py-2 pr-3 pl-4 ${alert.paused ? 'opacity-60' : ''}`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? undefined : alert.id)}
                className="min-h-11 min-w-0 flex-1 rounded-md py-1 text-left"
              >
                <AlertSummary alert={alert} />
              </button>
              <Switch
                aria-label={alert.paused ? 'Resume alert' : 'Pause alert'}
                checked={!alert.paused}
                onCheckedChange={(on) => setPaused(alert, !on)}
              />
            </div>

            {open && (
              <div className="grid gap-1 border-t px-4 py-3">
                <p className="pb-1 text-xs text-muted-foreground">
                  {alert.criteria.golfers.length ? `${alert.criteria.golfers[0]}+ golfers` : 'Any golfers'} · {holesLabel(alert.criteria.holes18)} · checked {everyLabel(alert.every)}
                </p>
                {m === undefined || m === 'loading' ? (
                  <p className="text-sm text-muted-foreground">Checking live times…</p>
                ) : m === 'error' ? (
                  <p className="text-sm text-destructive">Couldn't load times. Try again in a moment.</p>
                ) : m.fresh.length + m.seen.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No times match right now.</p>
                ) : (
                  <>
                    {[...m.fresh, ...m.seen].slice(0, showAll === alert.id ? undefined : 8).map((t) => (
                      <TimeRow key={timeKey(t)} t={t} label={m.fresh.includes(t) ? 'New' : undefined} link />
                    ))}
                    {showAll !== alert.id && m.fresh.length + m.seen.length > 8 && (
                      <Button variant="ghost" className="min-h-11 text-primary" onClick={() => setShowAll(alert.id)}>
                        Show {m.fresh.length + m.seen.length - 8} more
                      </Button>
                    )}
                  </>
                )}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="min-h-11 flex-1" onClick={() => setEditing(alert)}>Edit</Button>
                  <Button variant="ghost" className="min-h-11 text-flag" onClick={() => remove(alert)}>Delete</Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {editing && (
        <AlertSetupDialog
          key={editing.id}
          open
          mode="edit"
          criteria={editing.criteria}
          weekdays={editing.weekdays}
          every={editing.every}
          alertId={editing.id}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          onSaved={() => {
            if (openId === editing.id) loadMatches(editing.id);
            reload();
          }}
        />
      )}
    </div>
  );
}
