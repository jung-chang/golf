import { useEffect, useMemo, useState } from 'react';
import { go } from '../lib/nav';
import { clubStats, clubYards, PUTTER, shortName, shotYards, suggestClub } from '../lib/clubs';
import { getCourse } from '../lib/courses';
import { elevationFt, playsLike } from '../lib/elevation';
import { distYd, frontBack, M_TO_YD, pointInPolygon, type LngLat } from '../lib/geo';
import * as R from '../lib/round';
import { saveRound, setActive, useStore } from '../lib/store';
import type { Hole } from '../schemas/course';
import { HoleMap, labelAt } from './HoleMap';
import { useGeolocation, useWakeLock } from './useGeolocation';

const SIM = new URLSearchParams(location.search).has('sim');
const NEAR_HOLE_YD = 650; // farther than this from the green, measure from the tee
const yd = (n: number | null | undefined) => (n == null ? '–' : Math.round(n));

export function Play({ roundId }: { roundId: string }) {
  const round = useStore((s) => s.rounds[roundId]);
  const bag = useStore((s) => s.bag);
  const rounds = useStore((s) => s.rounds);
  const stats = useMemo(() => clubStats(Object.values(rounds)), [rounds]);
  const course = getCourse(round.courseId);
  const { fix, error, inject } = useGeolocation();
  useWakeLock();

  const [target, setTarget] = useState<LngLat | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [pinElev, setPinElev] = useState<number | null>(null);
  const [hereElev, setHereElev] = useState<number | null>(null);

  const hole = course?.holes.find((h) => h.number === round.current);
  const hs = round.holes[round.current] ?? R.emptyHole();
  const pin = hs.pin ?? hole?.green.center ?? [0, 0];
  const teePos: LngLat | undefined = hole && (hole.tees?.[round.teeId]?.pos ?? hole.path?.[0]);
  const live = !!(fix && hole && distYd(fix.pos, hole.green.center) < NEAR_HOLE_YD);
  const from: LngLat = live ? fix!.pos : teePos ?? hole?.green.center ?? [0, 0];

  // Elevation: ground at the pin, and at you (or the tee when you're not on the hole).
  useEffect(() => {
    setPinElev(hs.pin ? null : hole?.green.elevFt?.center ?? null);
    let stale = false;
    void elevationFt(pin).then((v) => !stale && v != null && setPinElev(v));
    return () => { stale = true; };
  }, [pin[0], pin[1]]);
  const fromKey = live ? `${fix!.pos[0].toFixed(4)},${fix!.pos[1].toFixed(4)}` : `tee${round.current}`;
  useEffect(() => {
    if (!live) return setHereElev(hole?.tees?.[round.teeId]?.elevFt ?? null);
    let stale = false;
    void elevationFt(from).then((v) => !stale && setHereElev(v));
    return () => { stale = true; };
  }, [fromKey]);

  // New hole: clear the target and manual club pick.
  useEffect(() => { setTarget(null); setPicked(null); }, [round.current]);

  if (!course || !hole) {
    return <div className="page"><p>This round's course ({round.courseId}) isn't installed.</p><button onClick={() => { setActive(null); go('golf'); }}>Back</button></div>;
  }

  const save = (r: typeof round, push = false) => saveRound(r, { push });
  const dPin = distYd(from, pin);
  const fb = hole.green.polygon ? frontBack(from, pin, hole.green.polygon) : null;
  const onGreen = live && !!hole.green.polygon && pointInPolygon(from, hole.green.polygon);
  const dz = pinElev != null && hereElev != null ? pinElev - hereElev : null;
  const aim = target ? distYd(from, target) : dz != null ? playsLike(dPin, hereElev!, pinElev!) : dPin;
  const sug = onGreen ? null : suggestClub(aim, bag, stats);
  const club = picked ?? (onGreen ? PUTTER : sug?.club.id ?? null);
  const clubName = bag.clubs.find((c) => c.id === club)?.name;
  const last = round.current === course.holes.at(-1)!.number;
  const played = R.playedHoles(round);

  function mark() {
    if (!club) return;
    if (club === PUTTER) return save(R.putt(round, fix?.pos ?? null));
    if (!fix) return alert('No GPS position yet.');
    if (fix.acc > 25 && !confirm(`GPS is only accurate to ±${Math.round(fix.acc * M_TO_YD)} y. Mark anyway?`)) return;
    save(R.markShot(round, club, fix.pos, fix.acc));
    setPicked(null);
    setTarget(null);
  }

  function step(d: number) {
    const nums = course!.holes.map((h) => h.number);
    const i = nums.indexOf(round.current) + d;
    if (i >= 0 && i < nums.length) save({ ...round, current: nums[i], updatedAt: new Date().toISOString() });
  }

  function done() {
    const r = R.holeDone(round, pin);
    if (!last) {
      const nums = course!.holes.map((h) => h.number);
      return save({ ...r, current: nums[nums.indexOf(round.current) + 1] }, true);
    }
    if (!confirm('Finish this round?')) return save(r);
    save({ ...r, done: true }, true);
    setActive(null);
    go(`golf/round/${round.id}`);
  }

  return (
    <div className="play">
      <header className="holebar">
        <button className="nav" aria-label="Previous hole" onClick={() => step(-1)}>‹</button>
        <div className="title">
          <strong>Hole {hole.number}</strong> · Par {hole.par}{hole.yards?.[round.teeId] ? ` · ${hole.yards[round.teeId]} y` : ''}
          {hole.hcp && <small> · HCP {hole.hcp}</small>}
          <div className="sub">
            {round.teeName} · {played.length ? `${R.fmtToPar(R.toPar(round))} thru ${played.length}` : 'not started'}
            {round.gameId && <> · <a href={`#games/${round.gameId}`} className="board">Leaderboard</a></>}
          </div>
        </div>
        <button className="nav" aria-label="Next hole" onClick={() => step(1)}>›</button>
      </header>

      <div className="mapwrap">
        <HoleMap
          hole={hole} from={from} here={fix?.pos ?? null} pin={pin} target={target} recenter={recenter}
          labels={target ? [labelAt(from, target, String(yd(distYd(from, target)))), labelAt(target, pin, String(yd(distYd(target, pin))))] : []}
          shotLines={hs.shots.filter((s) => s.end).map((s) => [s.pos, s.end!])}
          onTap={setTarget}
          onClearTarget={() => setTarget(null)}
          onPinMove={(p) => save(R.setPin(round, p))}
          onLongPress={SIM ? (p) => inject(p, 3) : undefined}
        />
        <div className={`gps${fix && fix.acc > 15 ? ' bad' : ''}`}>
          {error ? `GPS: ${error}` : fix ? `${live ? '' : 'Off hole · from tee · '}GPS ±${Math.round(fix.acc * M_TO_YD)} y`
            : SIM ? 'Sim: right-click / long-press to place yourself' : 'Waiting for GPS…'}
        </div>
        <button className="recenter" aria-label="Recenter" onClick={() => setRecenter((n) => n + 1)}>⤢</button>
      </div>

      <section className="panel">
        <div className="yardage">
          <div className="big">{yd(dPin)}<span className="unit">to pin</span></div>
          {fb && (
            <div className="fb">
              <div><small>Front</small>{yd(fb.front * M_TO_YD)}</div>
              <div><small>Back</small>{yd(fb.back * M_TO_YD)}</div>
            </div>
          )}
          <div className="info">
            {!target && dz != null && Math.abs(dz) >= 1 && (
              <div>Plays {yd(aim)} <span className="muted">({dz > 0 ? '↑' : '↓'} {Math.abs(dz).toFixed(0)} ft)</span></div>
            )}
            {target && <div>Target {yd(aim)} · then {yd(distYd(target, pin))} <span className="muted">(tap ○ to clear)</span></div>}
            {sug && <div>Club <strong>{sug.club.name} ({sug.club.yards})</strong>{sug.longer && <span className="muted"> · {sug.longer.name} {sug.longer.yards}</span>}</div>}
            <GreenTilt hole={hole} />
          </div>
        </div>

        <div className="clubs">
          {bag.clubs.filter((c) => c.on).map((c) => {
            const y = clubYards(c, stats, bag.useTracked);
            return (
              <button key={c.id} className={`chip${c.id === club ? ' on' : ''}${c.id === sug?.club.id ? ' sug' : ''}`} onClick={() => setPicked(c.id)}>
                {shortName(c.name)}{y && <small>{y}</small>}
              </button>
            );
          })}
        </div>

        <div className="actions">
          <button className="primary mark" onClick={mark} disabled={!club}>{club === PUTTER ? 'Putt' : `Mark shot · ${clubName ?? '–'}`}</button>
          <button onClick={() => save(R.putt(round, fix?.pos ?? null))}>Putt</button>
          <button onClick={() => save(R.penalty(round))}>Pen</button>
          <button onClick={() => save(R.undo(round))}>Undo</button>
        </div>

        <div className="scoreline">
          <div className="stepper">
            <button aria-label="Score minus one" onClick={() => save(R.adjust(round, -1))}>−</button>
            <div><small>Score</small><strong>{R.holeScore(hs)}</strong></div>
            <button aria-label="Score plus one" onClick={() => save(R.adjust(round, 1))}>+</button>
          </div>
          <div className="counts">Putts {hs.putts} · Pen {hs.penalties}</div>
          <button className="primary" onClick={done}>{last ? 'Finish round' : 'Hole done ›'}</button>
        </div>

        <ol className="shots">
          {hs.shots.map((s, i) => (
            <li key={i} className={s.mishit ? 'mishit' : ''} onClick={() => save(R.toggleMishit(round, i))} title="Tap to mark as mishit (excluded from club stats)">
              {i + 1}. {bag.clubs.find((c) => c.id === s.club)?.name ?? s.club}
              <span>{s.end ? `${yd(shotYards(s))} y` : '…'}</span>
              {s.mishit && <em>mishit</em>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function GreenTilt({ hole }: { hole: Hole }) {
  const e = hole.green.elevFt;
  if (e?.front == null || e.back == null || e.left == null || e.right == null) return null;
  const part = (d: number, hi: string, lo: string) => (Math.abs(d) < 0.5 ? null : `${d > 0 ? hi : lo} ${Math.abs(d).toFixed(1)} ft`);
  const bits = [part(e.back - e.front, 'back higher', 'front higher'), part(e.right - e.left, 'right higher', 'left higher')].filter(Boolean);
  return <div className="muted">Green: {bits.length ? bits.join(', ') : 'fairly flat'}</div>;
}
