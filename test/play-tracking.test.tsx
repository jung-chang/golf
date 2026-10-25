// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { defaultBag } from '../src/lib/clubs';
import { getCourse } from '../src/lib/courses';
import { emptyHole, holeScore, newRound } from '../src/lib/round';
import { offset } from '../src/lib/geo';
import { Round } from '../src/schemas/round';
import type { HoleMap } from '../src/play/HoleMap';
import type { Fix } from '../src/play/useGeolocation';

const f = vi.hoisted(() => ({
  state: { rounds: {} as Record<string, Round>, bag: {} as ReturnType<typeof defaultBag>, syncStatus: 'synced', saveError: null as string | null },
  fix: null as Fix | null, map: {} as ComponentProps<typeof HoleMap>, listeners: new Set<() => void>(),
}));
const retry = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/store', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useStore: (select: (s: typeof f.state) => unknown) => useSyncExternalStore(cb => { f.listeners.add(cb); return () => f.listeners.delete(cb); }, () => select(f.state)),
    getState: () => f.state,
    saveRound: (r: Round) => { f.state = { ...f.state, rounds: { ...f.state.rounds, [r.id]: r } }; f.listeners.forEach(cb => cb()); },
    sync: retry, setActive: vi.fn(),
  };
});
vi.mock('../src/play/useGeolocation', () => ({ useGeolocation: () => ({ fix: f.fix, error: f.fix ? null : 'denied', settledMs: 3000, inject: vi.fn() }), useWakeLock: vi.fn() }));
vi.mock('../src/play/HoleMap', () => ({ HoleMap: (p: ComponentProps<typeof HoleMap>) => {
  f.map = p;
  return <div aria-label="Course map">{p.pinCallout}{p.shotTags?.map((t, i) => <button key={i} onClick={() => p.onSelectShot?.(t.shotId!)}>{t.text}</button>)}
    {p.editing && <button onClick={() => p.editing!.onMove('pos', offset(p.from, 90, 10))}>Move start on map</button>}
  </div>;
} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { Play } from '../src/play/Play';

const course = getCourse('clearview-park')!, hole = course.holes[0];
let id: string, clock: number;
const current = () => f.state.rounds[id];
const advance = () => { clock += 1000; if (f.fix) f.fix = { ...f.fix, t: clock }; };
const fixAt = (pos: Fix['pos']) => { f.fix = { pos, acc: 3, t: clock }; };
beforeEach(() => {
  clock = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const round = newRound(course, course.tees[0].id); id = round.id;
  f.state = { rounds: { [id]: round }, bag: defaultBag(), syncStatus: 'synced', saveError: null };
  f.listeners.clear(); retry.mockClear(); fixAt(hole.tees![round.teeId].pos);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('explicit tracking on the course', () => {
  it('shows stock yardage, persists a pending club change through reload, and saves once', () => {
    const view = render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose club/ }));
    const driver = f.state.bag.clubs.find(c => c.id === 'dr')!;
    fireEvent.click(screen.getByRole('button', { name: `${driver.name}, stock ${driver.stock} yards` }));
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    expect(holeScore(current().holes[1])).toBe(0);
    const start = current().holes[1].pendingShot!.pos;
    fireEvent.click(screen.getByRole('button', { name: /Choose club/ }));
    const wedge = f.state.bag.clubs.find(c => c.id === 'pw')!;
    fireEvent.click(screen.getByRole('button', { name: `${wedge.name}, stock ${wedge.stock} yards` }));
    view.unmount(); f.state.rounds[id] = Round.parse(JSON.parse(JSON.stringify(current())));
    advance(); fixAt(hole.green.center); render(<Play roundId={id} />);
    expect(screen.getByRole('button', { name: /Save here.*Tracking PW shot/i })).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: 'Putt count' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save here.*Tracking/ }));
    expect(current().holes[1].shots).toHaveLength(1);
    expect(current().holes[1].shots[0]).toMatchObject({ club: 'pw', pos: start, end: hole.green.center });
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    expect(current().holes[1].pendingShot).toBeUndefined();
  });
  it('finishes a tracked chip before opening putts, supports six putts, and preserves the finish', () => {
    fixAt(offset(hole.green.center, 180, 20));
    const view = render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    advance(); fixAt(hole.green.center); view.rerender(<Play roundId={id} />);
    expect(screen.getByRole('button', { name: /Save here/ })).toBeTruthy();
    expect(f.map.view).toBe('hole');
    fireEvent.click(screen.getByRole('button', { name: /shot here and enter putts/ }));
    expect(current().holes[1].shots).toHaveLength(1);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Putt count' }), { target: { value: '6' } });
    advance(); fireEvent.click(screen.getByRole('button', { name: /Finish hole.*7 strokes/ }));
    expect(current().holes[1]).toMatchObject({ putts: 6, completed: true });
    expect(current().holes[1].shots[0].end).toEqual(hole.green.center);
    expect(current().current).toBe(2);
  });
  it('records missing GPS without fabricating endpoints and exposes local save retry', () => {
    f.fix = null; f.state.saveError = 'disk full';
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    advance(); fireEvent.click(screen.getByRole('button', { name: /Save here/ }));
    expect(current().holes[1].shots[0]).toMatchObject({ pos: null, end: null, origin: 'manual' });
    expect(holeScore(current().holes[1])).toBe(1);
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy();
  });
  it('adds a suggested missed shot in one tap and starts the next at the current position', () => {
    const tee = hole.tees![current().teeId].pos;
    fixAt(offset(tee, 0, 90));
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Add missed .*shot/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(current().holes[1].shots[0]).toMatchObject({ pos: tee, end: f.fix!.pos, origin: 'recovered' });
    expect(screen.queryByRole('button', { name: /Add missed .*shot/ })).toBeNull();
    advance(); fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    expect(current().holes[1].pendingShot!.pos).toEqual(f.fix!.pos);
    expect(current().holes[1].shots).toHaveLength(1);
  });
  it('edits a completed hole visually without changing its neighbors, completion, or active hole', () => {
    const tee = hole.tees![current().teeId].pos;
    const first = { id: 'one', club: 'dr', pos: tee, end: offset(tee, 0, 150), acc: 3, t: clock, mishit: false };
    const second = { ...first, id: 'two', club: 'pw', pos: first.end, end: hole.green.center };
    f.state.rounds[id] = { ...current(), current: 2, holes: { 1: { ...emptyHole(), shots: [first, second], completed: true, putts: 6, log: ['shot', 'shot', 'putt', 'putt', 'putt', 'putt', 'putt', 'putt'] } } };
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Hole 2.*scorecard/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Hole 1, 8$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Shot 1 ·/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move start on map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(current().holes[1].shots[0].pos).not.toEqual(tee);
    expect(current().holes[1].shots[0].end).toEqual(first.end);
    expect(current().holes[1].shots[1]).toEqual({ ...second, id: 'two' });
    expect(current().holes[1]).toMatchObject({ completed: true, putts: 6 });
    expect(current().current).toBe(2);
  });
  it('rejects an editor save if the same hole changed during editing', () => {
    f.fix = null;
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Add shot manually/ }));
    act(() => { f.state = { ...f.state, rounds: { [id]: { ...current(), holes: { 1: { ...emptyHole(), penalties: 1, log: ['pen'] } } } } }; f.listeners.forEach(cb => cb()); });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert').textContent).toMatch(/This hole changed/);
    expect(current().holes[1].penalties).toBe(1);
    expect(current().holes[1].shots).toHaveLength(0);
  });
});
