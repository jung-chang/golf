// Tapping a tee time: book it on TeeItUp, or propose it to the group.
import { useEffect, useState } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { go } from '@/lib/nav';
import { courseByCode } from '@/lib/nyc';
import { cn } from '@/lib/utils';
import type { Game } from '@/schemas/group';
import type { TeeTime } from '@/schemas/teetimes';
import { gameFor, openBooking, propose } from './booking';
import { capacity, dayLabel, ins, timeLabel } from './label';

export function TimeSheet({ time, onClose }: { time: TeeTime | null; onClose: () => void }) {
  const [proposing, setProposing] = useState(false);
  const [existing, setExisting] = useState<Game | undefined>();
  const [addTo, setAddTo] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProposing(false);
    setNote('');
    setExisting(undefined);
    if (time) gameFor(time).then((g) => { setExisting(g); setAddTo(!!g); }).catch(() => {});
  }, [time]);

  if (!time) return null;
  const course = courseByCode(time.code);

  const book = () => {
    openBooking({ code: time.code, date: time.date, time: time.time, teetime: time.teetime, slot: time });
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    try {
      const game = await propose(time, addTo && existing ? existing.id : null, note.trim());
      onClose();
      toast.success(addTo && existing ? 'Added to the group\'s game' : 'Proposed to the group', {
        action: { label: 'View', onClick: () => go(`games/${game.id}`) },
      });
    } catch {
      toast.error("Couldn't propose this time");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{timeLabel(time)} · {course?.name ?? time.code}</DialogTitle>
          <DialogDescription>
            {dayLabel(time.date)} · {time.spots} {time.spots === 1 ? 'spot' : 'spots'}{time.holes.includes(18) ? '' : ' · 9 holes'}
          </DialogDescription>
        </DialogHeader>

        {!proposing ? (
          <div className="grid gap-2">
            <Button className="min-h-12 text-base" onClick={book}><ExternalLink /> Book on TeeItUp</Button>
            <p className="px-1 text-xs text-muted-foreground">Pick {timeLabel(time)} there and pay. We'll ask when you're back.</p>
            <Button variant="outline" className="min-h-12 text-base" onClick={() => setProposing(true)}><Users /> Propose to the group</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            {existing && (
              <div className="grid gap-2" role="radiogroup" aria-label="Add to">
                <Choice on={addTo} onClick={() => setAddTo(true)} title="Add to the group's game"
                  sub={`${existing.times.map(timeLabel).join(', ')} · ${ins(existing).length} in, ${capacity(existing)} spots`} />
                <Choice on={!addTo} onClick={() => setAddTo(false)} title="New game" sub="Separate RSVPs" />
              </div>
            )}
            {!(addTo && existing) && (
              <Input placeholder="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            )}
            <DialogFooter>
              <Button variant="outline" className="min-h-11" onClick={() => setProposing(false)}>Back</Button>
              <Button className="min-h-11" onClick={submit} disabled={busy}>{addTo && existing ? 'Add tee time' : 'Propose'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Choice({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn('min-h-11 rounded-lg border px-3 py-2 text-left text-sm', on ? 'border-primary bg-accent' : 'bg-card')}
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}
