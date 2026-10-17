// Alerts: saved searches that ping you when a matching tee time opens. Reached from the bell on Tee times.
import { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Empty, PageHeader } from '@/components/page';
import { Button, buttonVariants } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { badgesChanged, closeSheet, go, openSheet, useOnResume } from '@/lib/nav';
import { enablePush, needsInstall, pushEnabled, pushSupported } from '@/lib/push';
import { alertCheckLabel } from '@/lib/alert-schedule';
import { daysOut } from '@/lib/nyc';
import { cn } from '@/lib/utils';
import { timeKey, type TeeTime } from '@/schemas/teetimes';
import type { Alert } from '@/schemas/group';
import { AlertSetupDialog } from './AlertSetupDialog';
import { dateLabel, everyLabel, holesLabel, repeatLabel, TimeRow, windowLabel } from './shared';

type Matches = { fresh: TeeTime[]; seen: TeeTime[] };
type PushState = 'off' | 'on' | 'unsupported';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const whenLabel = (a: Alert) => (a.weekdays.length ? repeatLabel(a.weekdays) : a.criteria.dates.map(dateLabel).join(', '));
const expired = (a: Alert) => !a.weekdays.length && a.criteria.dates.every((d) => daysOut(d) < 0);

export function Alerts({ focusId }: { focusId?: string }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>(() => (pushSupported() ? 'off' : 'unsupported'));
  const [editing, setEditing] = useState<Alert | null>(null);

  const reload = useCallback(() => {
    api<Alert[]>('/alerts').then(list => { setAlerts(list); setError(null); }).catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => { reload(); const timer = window.setInterval(reload, 60_000); return () => clearInterval(timer); }, [reload]);
  useOnResume(reload);

  useEffect(() => {
    if (push === 'unsupported') return;
    pushEnabled().then((on) => setPush(on ? 'on' : 'off')).catch(() => {});
  }, [push]);

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
      const updated = await api<Alert>(`/alerts/${alert.id}`, { method: 'PUT', body: { paused } });
      setAlerts(list => list?.map(a => a.id === alert.id ? updated : a) ?? null);
    } catch (e) {
      toast.error(errorText(e));
      reload();
    }
  };

  const remove = async (alert: Alert) => {
    try {
      await api(`/alerts/${alert.id}`, { method: 'DELETE' });
      setAlerts((list) => list?.filter((a) => a.id !== alert.id) ?? null);
      closeSheet('alerts');
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

  const markRead = useCallback((id: string) => {
    setAlerts((list) => list?.map((a) => (a.id === id ? { ...a, unread: [] } : a)) ?? null);
    badgesChanged();
  }, []);

  const open = alerts?.find((a) => a.id === focusId);

  return (
    <div className="pb-8">
      <PageHeader back={() => go('')} title="Alerts" sub="We check TeeItUp and ping you when a time opens" />

      <div className="space-y-3 px-4 pt-2">
        {push === 'unsupported' && (
          <div className="flex items-start gap-3 rounded-2xl bg-secondary p-4 text-sm text-secondary-foreground">
            <BellOff className="mt-0.5 size-5 shrink-0" />
            <p>{needsInstall() ? 'Add this app to your Home Screen, then enable phone notifications.' : 'Phone notifications are unavailable in this browser.'}</p>
          </div>
        )}
        {push === 'off' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-secondary p-4 text-sm text-secondary-foreground">
            <p>Notifications are off on this phone.</p>
            <Button className="min-h-11 rounded-full" onClick={turnOn}>Turn on</Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!alerts && !error && [0, 1].map((i) => <Skeleton key={i} className="h-[4.5rem] rounded-2xl" />)}
        {alerts?.length === 0 && (
          <Empty icon={<BellRing />} title="No alerts yet" action={<a href="#" className={cn(buttonVariants(), 'min-h-11 rounded-full px-5')}>Search tee times</a>}>
            Search, then tap the bell on the results to hear when a matching time opens.
          </Empty>
        )}

        {alerts?.map((alert) => (
          <div key={alert.id} className={cn('flex items-center gap-1 rounded-2xl border bg-card pr-3', alert.paused && 'opacity-60')}>
            <button type="button" onClick={() => openSheet(`alerts/${alert.id}`)} className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 rounded-2xl py-2 pl-3 text-left active:bg-accent">
              <span className="grid size-10 shrink-0 place-content-center rounded-xl bg-accent text-accent-foreground"><BellRing className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('truncate font-semibold', expired(alert) && 'text-muted-foreground line-through')}>{whenLabel(alert)}</span>
                  {alert.unread.length > 0 && <span className="shrink-0 rounded-full bg-orange px-2 text-xs leading-5 font-semibold text-orange-foreground">{alert.unread.length} new</span>}
                </span>
                <span className="block truncate text-sm text-muted-foreground">{alert.criteria.codes.join(', ')} · {windowLabel(alert.criteria.window)}</span>
                <AlertStatus alert={alert} />
                <span className="block text-xs text-muted-foreground">{push === 'on' ? 'Phone notifications on' : 'Phone notifications off'}</span>
              </span>
            </button>
            <Switch aria-label={alert.paused ? 'Resume alert' : 'Pause alert'} disabled={expired(alert)} checked={!alert.paused && !expired(alert)} onCheckedChange={(on) => setPaused(alert, !on)} />
          </div>
        ))}
      </div>

      <AlertSheet alert={open} onClose={() => closeSheet('alerts')} onEdit={(a) => {
        // Replace detail before opening the editor so an asynchronous history.back()
        // cannot immediately dismiss the new sheet.
        history.replaceState(null, '', '#alerts');
        dispatchEvent(new HashChangeEvent('hashchange'));
        setEditing(a);
      }} onDelete={remove} onRead={markRead} />

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
          onSaved={reload}
        />
      )}
    </div>
  );
}

/** One alert: what it watches, and what matches right now (live). Opening it marks its new times read. */
function AlertSheet({ alert, onClose, onEdit, onDelete, onRead }: {
  alert: Alert | undefined; onClose: () => void; onEdit: (a: Alert) => void; onDelete: (a: Alert) => void; onRead: (id: string) => void;
}) {
  const [matches, setMatches] = useState<Matches | 'error' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const id = alert?.id;
  const unread = alert?.unread.length ?? 0;

  useEffect(() => {
    if (!id) return;
    setMatches(null);
    setShowAll(false);
    api<Matches>(`/alerts/${id}/matches?force=1`).then(setMatches).catch(() => setMatches('error'));
  }, [id, alert?.criteria]);

  useEffect(() => {
    if (!id || !unread) return;
    api(`/alerts/${id}`, { method: 'PUT', body: { read: true } }).then(() => onRead(id)).catch(() => {});
  }, [id, unread, onRead]);

  const all = matches && matches !== 'error' ? [...matches.fresh, ...matches.seen] : [];

  return (
    <Drawer historyManaged open={!!alert} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        {alert && (
          <>
            <DrawerHeader>
              <DrawerTitle>{whenLabel(alert)}</DrawerTitle>
              <DrawerDescription>
                {alert.criteria.codes.join(', ')} · {windowLabel(alert.criteria.window)} · {alert.criteria.golfers.length ? `${alert.criteria.golfers[0]}+ golfers` : 'any golfers'} · {holesLabel(alert.criteria.holes18)} · checked {everyLabel(alert.every)}
              </DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <div className="pb-3"><AlertStatus alert={alert} /></div>
              <h3 className="pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Open now · tap to book</h3>
              {matches === null ? (
                <div className="space-y-1.5 py-1">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
              ) : matches === 'error' ? (
                <p className="py-2 text-sm text-destructive">Couldn't load times. Try again in a moment.</p>
              ) : all.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Nothing matches right now. New openings appear after a successful check.</p>
              ) : (
                <div className="divide-y">
                  {all.slice(0, showAll ? undefined : 8).map((t) => (
                    <TimeRow key={timeKey(t)} t={t} label={matches.fresh.includes(t) ? 'New' : undefined} link />
                  ))}
                  {!showAll && all.length > 8 && (
                    <Button variant="ghost" className="min-h-11 w-full text-primary" onClick={() => setShowAll(true)}>Show {all.length - 8} more</Button>
                  )}
                </div>
              )}
            </div>
            <DrawerFooter className="flex-row border-t">
              <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => onEdit(alert)}><Pencil /> Edit</Button>
              <Button variant="ghost" className="h-12 rounded-2xl text-flag" onClick={() => onDelete(alert)}><Trash2 /> Delete</Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function AlertStatus({ alert }: { alert: Alert }) {
  const next = alert.nextCheckAt ? alertCheckLabel(alert.nextCheckAt) : null;
  return <span className="block space-y-0.5 text-xs text-muted-foreground">
    <span className="block">{expired(alert) ? 'Expired' : alert.paused ? 'Paused' : `${everyLabel(alert.every)} · ${next ? `${alert.checkedAt ? 'Next scheduled check' : 'First check scheduled'}: ${next}` : 'Schedule unavailable'}`}</span>
    {alert.checkFailed && <span className="block text-orange-strong">Couldn’t refresh all courses.{!alert.paused && next ? ` Retrying ${next}.` : ''}</span>}
    <span className="block">{alert.checkedAt ? `Last successful check: ${alertCheckLabel(alert.checkedAt)}` : 'No successful checks yet'}</span>
  </span>;
}
