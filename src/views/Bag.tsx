import { useMemo, type FormEvent } from 'react';
import { clubStats, MIN_TRACKED, PUTTER } from '../lib/clubs';
import { getState, saveBag, saveRound, useStore } from '../lib/store';
import { Backup, type Club } from '../schemas/round';

export function BagView() {
  const bag = useStore((s) => s.bag);
  const rounds = useStore((s) => s.rounds);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);

  const update = (clubs: Club[]) => saveBag({ ...bag, clubs });
  const edit = (i: number, patch: Partial<Club>) => update(bag.clubs.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  const moveUp = (i: number) => {
    if (!i) return;
    const c = [...bag.clubs];
    [c[i - 1], c[i]] = [c[i], c[i - 1]];
    update(c);
  };

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name')).trim();
    if (!name) return;
    const club = { id: `c${Date.now().toString(36)}`, name, stock: Number(f.get('stock')) || null, on: true };
    update([...bag.clubs.filter((c) => c.id !== PUTTER), club, ...bag.clubs.filter((c) => c.id === PUTTER)]);
    e.currentTarget.reset();
  }

  function exportBackup() {
    const s = getState();
    const data: Backup = { rounds: Object.values(s.rounds), bag: s.bag };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `golf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }

  async function importBackup(file: File) {
    const parsed = Backup.safeParse(JSON.parse(await file.text()));
    if (!parsed.success) return alert(`Not a valid backup:\n${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
    const have = getState().rounds;
    let added = 0;
    for (const r of parsed.data.rounds) {
      if (!have[r.id] || r.updatedAt > have[r.id].updatedAt) { saveRound(r); added++; }
    }
    saveBag(parsed.data.bag);
    alert(`Imported ${added} round${added === 1 ? '' : 's'} and your bag.`);
  }

  return (
    <div className="page">
      <h2>Bag</h2>
      <p className="muted">Stock = your typical full-swing total distance. Tracked = median of your last 10 measured shots (mishits excluded).</p>
      <div className="scroll-x">
        <table className="bag">
          <thead><tr><th /><th>Club</th><th>Stock</th><th>Tracked</th><th /></tr></thead>
          <tbody>
            {bag.clubs.map((c, i) => {
              const st = stats[c.id];
              return (
                <tr key={c.id} className={c.on ? '' : 'off'}>
                  <td><input type="checkbox" checked={c.on} onChange={(e) => edit(i, { on: e.target.checked })} /></td>
                  <td>{c.name}</td>
                  <td>
                    {c.id !== PUTTER && (
                      <input className="num" type="number" inputMode="numeric" defaultValue={c.stock ?? ''}
                        onBlur={(e) => edit(i, { stock: e.target.value ? Number(e.target.value) : null })} />
                    )}
                  </td>
                  <td className="tracked">
                    {st ? <><strong>{Math.round(st.recent)}</strong><small> all {Math.round(st.median)} · n={st.n}</small></> : <span className="muted">–</span>}
                  </td>
                  <td><button className="icon" aria-label={`Move ${c.name} up`} onClick={() => moveUp(i)}>↑</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="row addclub" onSubmit={add}>
        <input name="name" placeholder="Add club (e.g. 2 Iron)" />
        <input name="stock" type="number" placeholder="yds" className="num" />
        <button>Add</button>
      </form>
      <label className="toggle">
        <input type="checkbox" checked={bag.useTracked} onChange={(e) => saveBag({ ...bag, useTracked: e.target.checked })} />
        Suggest clubs from tracked distances once a club has {MIN_TRACKED}+ shots
      </label>
      <h2>Backup</h2>
      <p className="muted">Rounds sync to your server automatically. A file backup is still handy.</p>
      <div className="row">
        <button onClick={exportBackup}>Export</button>
        <label className="button">
          Import
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
