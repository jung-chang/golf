// First visit: name, home course, notifications, and (on iPhone in Safari) how to install.
import { useEffect, useState } from 'react';
import { Share } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { enablePush, needsInstall, pushEnabled, pushSupported } from '@/lib/push';
import type { Member } from '@/schemas/group';
import { HomeCourseSelect } from './HomeCourseSelect';

const LATER_KEY = 'golf.welcome.later';

export function Welcome() {
  const [me, setMe] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [home, setHome] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem(LATER_KEY)) return; } catch { /* storage blocked: just ask */ }
    api<Member>('/me').then((m) => { if (!m.name) setMe(m); }).catch(() => {});
    pushEnabled().then(setPushOn).catch(() => {});
  }, []);

  const later = () => {
    try { sessionStorage.setItem(LATER_KEY, '1'); } catch { /* fine */ }
    setMe(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api('/me', { method: 'PUT', body: { name: name.trim(), homeCourse: home } });
      setMe(null);
      toast.success('Welcome to the group');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    try {
      await enablePush();
      setPushOn(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't turn on notifications");
    }
  };

  return (
    <Dialog open={!!me} onOpenChange={(o) => { if (!o) later(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Welcome</DialogTitle>
          <DialogDescription>Tell the group who you are. You can change this later in Profile.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="welcome-name" className="text-sm font-medium">Name</label>
            <Input id="welcome-name" className="h-11 text-base" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <label htmlFor="welcome-course" className="text-sm font-medium">Home course</label>
            <HomeCourseSelect id="welcome-course" value={home} onChange={setHome} />
          </div>

          {needsInstall() ? (
            <div className="rounded-md bg-secondary p-3 text-sm">
              <p className="font-medium">Get notifications on iPhone</p>
              <p className="text-muted-foreground">
                Tap <Share className="inline size-4 align-text-bottom" /> Share, then <b>Add to Home Screen</b>.
                Open the app from your Home Screen and sign in once more there.
              </p>
            </div>
          ) : pushSupported() && !pushOn && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-secondary p-3 text-sm">
              <p>Get told about new games and tee times</p>
              <Button variant="outline" className="min-h-11" onClick={turnOn}>Turn on</Button>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={later} disabled={busy}>Later</Button>
          <Button className="min-h-11" onClick={save} disabled={busy || !name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
