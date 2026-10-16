// Back from TeeItUp: "Did you book it?" Yes marks it booked in the group's game and tells them.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { badgesChanged, go } from '@/lib/nav';
import { courseByCode } from '@/lib/nyc';
import { clearBooking, pendingBooking, recordBooking, type Pending } from './booking';
import { dayLabel, timeLabel } from './label';

export function BookingCheck() {
  const [p, setP] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // Ask once you're back (a few seconds after leaving, so opening the page doesn't trigger it).
  const check = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const pending = pendingBooking();
    if (pending && Date.now() - pending.at > 5000) setP(pending);
  }, []);
  useEffect(() => {
    check();
    document.addEventListener('visibilitychange', check);
    addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      removeEventListener('focus', check);
    };
  }, [check]);

  const close = () => { clearBooking(); setP(null); };

  const yes = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const game = await recordBooking(p);
      close();
      badgesChanged();
      toast.success('Booked. The group can see it.', { action: { label: 'View', onClick: () => go(`games/${game.id}`) } });
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const name = p ? courseByCode(p.code)?.name ?? p.code : '';
  return (
    <Dialog open={!!p} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Did you book {p && timeLabel(p)} at {name}?</DialogTitle>
          <DialogDescription>
            {p && dayLabel(p.date)}. The app can't see TeeItUp's receipt, so Yes is how the group finds out.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={close} disabled={busy}>Not yet</Button>
          <Button className="min-h-11" onClick={yes} disabled={busy}>Yes, I booked it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
