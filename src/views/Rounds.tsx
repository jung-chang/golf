import { go } from '../lib/nav';
import { shotYards } from '../lib/clubs';
import { fmtToPar, holeScore, playedHoles, toPar, totalScore } from '../lib/round';
import { deleteRound, setActive, useStore } from '../lib/store';
import type { Round } from '../schemas/round';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function Rounds() {
  const rounds = useStore((s) => s.rounds);
  const list = Object.values(rounds).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="page">
      <h2>Rounds</h2>
      {!list.length && <p className="muted">No rounds yet.</p>}
      <div className="list">
        {list.map((r) => (
          <a key={r.id} className="card rowcard" href={`#golf/round/${r.id}`}>
            <div>
              <strong>{r.courseName}</strong>
              <div className="muted">{fmtDate(r.date)} · {r.teeName}{r.done ? '' : ' · in progress'}</div>
            </div>
            <div className="score">
              {totalScore(r) || '–'}
              <small>{playedHoles(r).length ? `${fmtToPar(toPar(r))} · ${playedHoles(r).length} holes` : ''}</small>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function Nine({ r, nums, label }: { r: Round; nums: number[]; label: string }) {
  const sum = (f: (n: number) => number) => nums.reduce((s, n) => s + f(n), 0);
  return (
    <table className="scorecard">
      <tbody>
        <tr><th>Hole</th>{nums.map((n) => <th key={n}>{n}</th>)}<th>{label}</th></tr>
        <tr><td>Par</td>{nums.map((n) => <td key={n}>{r.pars[n]}</td>)}<td>{sum((n) => r.pars[n] ?? 0)}</td></tr>
        <tr className="strong">
          <td>Score</td>
          {nums.map((n) => {
            const sc = holeScore(r.holes[n]);
            const d = sc - (r.pars[n] ?? 0);
            return <td key={n} className={!sc ? '' : d < 0 ? 'birdie' : d > 1 ? 'double' : d === 1 ? 'bogey' : ''}>{sc || ''}</td>;
          })}
          <td>{sum((n) => holeScore(r.holes[n])) || ''}</td>
        </tr>
        <tr><td>Putts</td>{nums.map((n) => <td key={n}>{r.holes[n]?.putts || ''}</td>)}<td>{sum((n) => r.holes[n]?.putts ?? 0) || ''}</td></tr>
      </tbody>
    </table>
  );
}

export function RoundDetail({ id }: { id: string }) {
  const r = useStore((s) => s.rounds[id]);
  const bag = useStore((s) => s.bag);
  if (!r) return <div className="page"><a href="#golf/rounds" className="back">‹ Rounds</a><p>Round not found.</p></div>;
  const nums = Object.keys(r.pars).map(Number).sort((a, b) => a - b);
  const name = (id: string) => bag.clubs.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="page">
      <a href="#golf/rounds" className="back">‹ Rounds</a>
      <h2>{r.courseName}</h2>
      <p className="muted">{fmtDate(r.date)} · {r.teeName} · {totalScore(r)} ({fmtToPar(toPar(r))})</p>
      <div className="scroll-x">
        <Nine r={r} nums={nums.slice(0, 9)} label="Out" />
        {nums.length > 9 && <Nine r={r} nums={nums.slice(9)} label="In" />}
      </div>
      <h3>Shots</h3>
      <div className="shotlog">
        {nums.filter((n) => r.holes[n]?.shots.length || r.holes[n]?.putts).map((n) => {
          const h = r.holes[n];
          const parts = h.shots.map((s) => `${name(s.club)}${s.end ? ` ${Math.round(shotYards(s)!)}` : ''}${s.mishit ? '*' : ''}`);
          if (h.putts) parts.push(`${h.putts} putt${h.putts > 1 ? 's' : ''}`);
          if (h.penalties) parts.push(`${h.penalties} pen`);
          return <div key={n}><strong>#{n} </strong>{parts.join(' → ')}</div>;
        })}
      </div>
      <div className="row">
        {!r.done && <button className="primary" onClick={() => { setActive(r.id); go('golf/play'); }}>Continue round</button>}
        <button className="danger" onClick={() => { if (confirm('Delete this round permanently?')) { deleteRound(r.id); go('golf/rounds'); } }}>Delete round</button>
      </div>
    </div>
  );
}
