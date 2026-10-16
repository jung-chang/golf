// Your bag: which clubs you carry, how far you think they go (stock), and how far they really go (tracked).
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Group, Row } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { clubStats, MIN_TRACKED, PUTTER } from '@/lib/clubs';
import { getState, saveBag, saveRound, useStore } from '@/lib/store';
import { Backup, type Club } from '@/schemas/round';

export function BagView() {
  const bag = useStore((s) => s.bag);
  const rounds = useStore((s) => s.rounds);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const update = (clubs: Club[]) => saveBag({ ...bag, clubs });
  const edit = (i: number, patch: Partial<Club>) => update(bag.clubs.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= bag.clubs.length) return;
    const c = [...bag.clubs];
    [c[i], c[j]] = [c[j], c[i]];
    update(c);
    setEditing(j);
  };
  const add = (name: string, stock: number | null) => {
    const club = { id: `c${Date.now().toString(36)}`, name, stock, on: true };
    update([...bag.clubs.filter((c) => c.id !== PUTTER), club, ...bag.clubs.filter((c) => c.id === PUTTER)]);
  };

  function exportBackup() {
    const s = getState();
    const data: Backup = { rounds: Object.values(s.rounds), bag: s.bag };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `golf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  async function importBackup(file: File) {
    let parsed;
    try { parsed = Backup.safeParse(JSON.parse(await file.text())); } catch { parsed = null; }
    if (!parsed?.success) return void toast.error("That file isn't a backup from this app");
    const have = getState().rounds;
    let added = 0;
    for (const r of parsed.data.rounds) {
      if (!have[r.id] || r.updatedAt > have[r.id].updatedAt) { saveRound(r); added++; }
    }
    saveBag(parsed.data.bag);
    toast.success(`Imported ${added} ${added === 1 ? 'round' : 'rounds'} and your bag`);
  }

  const current = typeof editing === 'number' ? bag.clubs[editing] : undefined;

  return (
    <div className="space-y-5">
      <Group title="Clubs" aside={<span className="text-xs text-muted-foreground">tracked = median of your last 10</span>}>
        {bag.clubs.map((c, i) => {
          const st = stats[c.id];
          return (
            <Row
              key={c.id}
              label={<span className={c.on ? '' : 'text-muted-foreground line-through'}>{c.name}</span>}
              sub={c.id === PUTTER ? 'Putts are counted, not measured' : `Stock ${c.stock ?? '–'} y${st ? ` · ${st.n} ${st.n === 1 ? 'shot' : 'shots'}` : ''}`}
              value={st && c.id !== PUTTER ? <span className="font-semibold text-foreground">{Math.round(st.recent)} y</span> : undefined}
              onClick={() => setEditing(i)}
            />
          );
        })}
        <Row icon={<Plus />} label={<span className="text-primary">Add a club</span>} onClick={() => setEditing('new')} />
      </Group>

      <Group>
        <Row label="Suggest clubs from tracked distances" sub={`Once a club has ${MIN_TRACKED}+ shots; otherwise your stock yardage`}>
          <Switch checked={bag.useTracked} onCheckedChange={(v) => saveBag({ ...bag, useTracked: v })} aria-label="Suggest from tracked distances" />
        </Row>
      </Group>

      <Group title="Backup" aside={<span className="text-xs text-muted-foreground">rounds also sync automatically</span>}>
        <Row icon={<Download />} label="Export to a file" onClick={exportBackup} />
        <label className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 py-2 active:bg-accent">
          <span className="grid size-8 shrink-0 place-content-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4"><Upload /></span>
          <span className="flex-1 text-[0.9375rem]">Import a backup</span>
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importBackup(e.target.files[0])} />
        </label>
      </Group>

      <ClubSheet
        open={editing !== null}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        club={current}
        isFirst={editing === 0}
        isLast={typeof editing === 'number' && editing === bag.clubs.length - 1}
        onSave={(name, stock, on) => {
          if (editing === 'new') add(name, stock);
          else if (typeof editing === 'number') edit(editing, { name, stock, on });
          setEditing(null);
        }}
        onMove={(d) => typeof editing === 'number' && move(editing, d)}
      />
    </div>
  );
}

/** Add or edit one club: name, stock yards, in the bag or not, and its place in the list. */
function ClubSheet({ open, onOpenChange, club, isFirst, isLast, onSave, onMove }: {
  open: boolean; onOpenChange: (o: boolean) => void; club?: Club; isFirst: boolean; isLast: boolean;
  onSave: (name: string, stock: number | null, on: boolean) => void; onMove: (d: -1 | 1) => void;
}) {
  const [name, setName] = useState('');
  const [stock, setStock] = useState('');
  const [on, setOn] = useState(true);
  const [key, setKey] = useState<string | undefined>();
  // Fill the form whenever a different club (or a new one) opens.
  const id = open ? club?.id ?? 'new' : undefined;
  if (id !== key) {
    setKey(id);
    setName(club?.name ?? '');
    setStock(club?.stock != null ? String(club.stock) : '');
    setOn(club?.on ?? true);
  }
  const putter = club?.id === PUTTER;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{club ? club.name : 'Add a club'}</DrawerTitle>
          <DrawerDescription>Stock is how far a normal full swing goes, carry plus roll.</DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4 px-5 pt-1">
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="grid gap-2">
              <label htmlFor="club-name" className="text-sm font-medium">Club</label>
              <Input id="club-name" className="h-12 rounded-xl text-base" placeholder="e.g. 4 Hybrid" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!putter && (
              <div className="grid gap-2">
                <label htmlFor="club-stock" className="text-sm font-medium">Stock (y)</label>
                <Input id="club-stock" className="h-12 rounded-xl text-base tabular-nums" type="number" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
              </div>
            )}
          </div>
          {club && (
            <>
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-card px-4">
                <span className="text-sm font-medium">In my bag</span>
                <Switch checked={on} onCheckedChange={setOn} />
              </label>
              <div className="flex gap-2">
                <Button variant="outline" className="h-11 flex-1 rounded-xl" disabled={isFirst} onClick={() => onMove(-1)}><ArrowUp /> Move up</Button>
                <Button variant="outline" className="h-11 flex-1 rounded-xl" disabled={isLast} onClick={() => onMove(1)}><ArrowDown /> Move down</Button>
              </div>
            </>
          )}
        </div>
        <DrawerFooter className="flex-row">
          <Button variant="outline" className="h-12 flex-1 rounded-2xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-12 flex-[2] rounded-2xl text-base" disabled={!name.trim()}
            onClick={() => onSave(name.trim(), stock ? Number(stock) : null, on)}>
            {club ? 'Save' : 'Add club'}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
