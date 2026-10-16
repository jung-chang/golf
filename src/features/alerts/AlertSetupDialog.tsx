// Set up or edit an alert. Create is read-only (it inherits the results screen); edit lets you change the criteria.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api';
import { enablePush, pushEnabled, pushSupported } from '@/lib/push';
import { MAX_DAYS, NYC_COURSES, nyToday, weekdayOf } from '@/lib/nyc';
import { fmtMinutes } from '@/lib/teetimes';
import { timeKey, type Criteria, type TeeTime } from '@/schemas/teetimes';
import { CriteriaSummary, EVERY_OPTIONS, TimeRow, dateLabel, repeatLabel, windowLabel } from './shared';
import type { Alert } from '@/schemas/group';

export type AlertSetupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** create: read-only criteria from the results screen. edit: criteria editable. */
  mode: 'create' | 'edit';
  criteria: Criteria;
  /** create only: the times currently shown on the results screen (become "already seen"). */
  visible?: TeeTime[];
  /** edit only: the alert being edited, and the days it repeats on. */
  alertId?: string;
  weekdays?: number[];
  every?: Alert['every'];
  onSaved?: () => void;
};

type Matches = { fresh: TeeTime[]; seen: TeeTime[] };

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dateOptions = () => {
  const today = nyToday();
  return Array.from({ length: MAX_DAYS + 1 }, (_, i) => addDays(today, i));
};
const LIVE_COURSES = NYC_COURSES.filter((c) => c.tenant !== null);
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export function AlertSetupDialog({ open, onOpenChange, mode, criteria, visible = [], alertId, weekdays = [], every: savedEvery = 4, onSaved }: AlertSetupProps) {
  const [draft, setDraft] = useState<Criteria>(criteria);
  const [repeat, setRepeat] = useState(weekdays.length > 0);
  const [every, setEvery] = useState<Alert['every']>(savedEvery);
  // Repeating watches the same days of the week as the chosen dates, every week.
  const days = [...new Set((mode === 'edit' ? draft : criteria).dates.map(weekdayOf))];
  const repeatDays = repeat ? days : [];
  const [matches, setMatches] = useState<Matches | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(criteria);
      setRepeat(weekdays.length > 0);
      setEvery(savedEvery);
    }
  }, [open, criteria]);

  useEffect(() => {
    if (!open || mode !== 'edit' || !alertId) return;
    setMatches(null);
    api<Matches>(`/alerts/${alertId}/matches?force=1`).then(setMatches).catch(() => setMatches({ fresh: [], seen: [] }));
  }, [open, mode, alertId]);

  const set = (patch: Partial<Criteria>) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const createSave = async () => {
    setBusy(true);
    try {
      // Push first: the permission prompt has to come straight from this tap.
      let pushError: string | undefined;
      if (pushSupported() && !(await pushEnabled())) {
        try { await enablePush(); } catch (e) { pushError = errorText(e); }
      }
      await api('/alerts', { body: { criteria, seen: visible.map(timeKey), weekdays: repeatDays, every } });
      toast.success(pushError ? `Alert set. Notifications are off: ${pushError}` : 'Alert set. We will tell you when new times open.');
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const editSave = async () => {
    setBusy(true);
    try {
      await api(`/alerts/${alertId}`, { method: 'PUT', body: { criteria: draft, weekdays: repeatDays, every } });
      toast.success('Alert updated');
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const canSave = mode === 'create' || (draft.dates.length > 0 && draft.codes.length > 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{mode === 'edit' ? 'Edit alert' : 'Alert me about new times'}</DrawerTitle>
          <DrawerDescription>
            {mode === 'edit'
              ? 'Change what this alert watches for.'
              // Everything showing now counts as seen: only times that open up later alert you.
              : `${visible.length ? `${visible.length} ${visible.length === 1 ? 'time matches' : 'times match'} now. ` : ''}You'll hear only about new ones.`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pt-1 pb-2">
        {mode === 'create' ? (
          <CriteriaSummary criteria={criteria} />
        ) : (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <Label>Dates (up to 3)</Label>
              <div className="flex flex-wrap gap-2">
                {dateOptions().map((d) => (
                  <Toggle
                    key={d}
                    variant="outline"
                    className="min-h-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    pressed={draft.dates.includes(d)}
                    disabled={!draft.dates.includes(d) && draft.dates.length >= 3}
                    onPressedChange={() => {
                      if (draft.dates.includes(d) && draft.dates.length === 1) return;
                      set({ dates: draft.dates.includes(d) ? draft.dates.filter((x) => x !== d) : [...draft.dates, d].sort() });
                    }}
                  >
                    {dateLabel(d)}
                  </Toggle>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <Label>Golfers</Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <Toggle
                    key={n}
                    variant="outline"
                    className="min-h-11 min-w-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    pressed={draft.golfers.includes(n)}
                    onPressedChange={() => set({ golfers: toggle(draft.golfers, n).sort() })}
                  >
                    {n}
                  </Toggle>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <Label>Courses</Label>
              <div className="flex flex-wrap gap-2">
                {LIVE_COURSES.map((course) => (
                  <Toggle
                    key={course.code}
                    variant="outline"
                    className="min-h-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    pressed={draft.codes.includes(course.code)}
                    onPressedChange={() => set({ codes: toggle(draft.codes, course.code) })}
                  >
                    {course.name}
                  </Toggle>
                ))}
              </div>
            </fieldset>

            <div className="flex min-h-11 items-center gap-3">
              <Checkbox id="alert-18" checked={draft.holes18} onCheckedChange={(v) => set({ holes18: v === true })} />
              <Label htmlFor="alert-18">18 holes only</Label>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between text-sm">
                <Label>Time window</Label>
                <span className="text-muted-foreground tabular-nums">{windowLabel(draft.window)}</span>
              </div>
              <Slider
                min={300}
                max={1200}
                step={15}
                value={draft.window}
                onValueChange={(v) => v.length === 2 && set({ window: [v[0], v[1]] })}
                aria-label="Time window"
                className="py-3"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{fmtMinutes(300)}</span>
                <span>{fmtMinutes(1200)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex min-h-11 items-center gap-3">
          <Checkbox id="alert-repeat" checked={repeat} onCheckedChange={(v) => setRepeat(v === true)} />
          <Label htmlFor="alert-repeat">Repeat weekly{days.length > 0 && ` (${repeatLabel(days).replace('Every ', '')})`}</Label>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="alert-every">Check</Label>
          <select
            id="alert-every"
            className="h-12 w-full rounded-xl border bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            value={every}
            onChange={(e) => setEvery(Number(e.target.value) as Alert['every'])}
          >
            {EVERY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`${o.label} (${o.hint})`}</option>)}
          </select>
        </div>

        {mode === 'edit' && (
          <section className="grid gap-1">
            <h3 className="text-sm font-medium">Matching now</h3>
            <div className="grid max-h-56 gap-1 overflow-y-auto">
              {matches === null ? (
                <p className="text-sm text-muted-foreground">Checking live times…</p>
              ) : matches.fresh.length + matches.seen.length === 0 ? (
                <p className="text-sm text-muted-foreground">No times match right now.</p>
              ) : (
                <>
                  {matches.fresh.map((t) => <TimeRow key={timeKey(t)} t={t} label="New" />)}
                  {matches.seen.map((t) => <TimeRow key={timeKey(t)} t={t} />)}
                </>
              )}
            </div>
          </section>
        )}

        </div>

        <DrawerFooter className="flex-row border-t">
          {mode === 'create' ? (
            <>
              <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button className="h-12 flex-[2] rounded-2xl text-base" onClick={createSave} disabled={busy}>Set alert</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button className="h-12 flex-[2] rounded-2xl text-base" onClick={editSave} disabled={busy || !canSave}>Save</Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
