// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { defaultBag } from '../src/lib/clubs';
import { getCourse } from '../src/lib/courses';
import { emptyHole, holeScore, newRound } from '../src/lib/round';
import { bearing, offset } from '../src/lib/geo';
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
    sync: retry, setActive: vi.fn(), deleteRound: vi.fn(),
  };
});
vi.mock('../src/play/useGeolocation', () => ({ useGeolocation: () => ({ fix: f.fix, error: f.fix ? null : 'denied', settledMs: 3000, inject: vi.fn() }), useWakeLock: vi.fn() }));
vi.mock('../src/play/HoleMap', () => ({ HoleMap: (p: ComponentProps<typeof HoleMap>) => {
  f.map = p;
  return <div aria-label="Course map">{p.pinCallout}{p.shotTags?.map((t, i) => <button key={i} aria-label={t.actionLabel} onClick={() => p.onSelectShot?.(t.shotId!)}>{t.text}</button>)}
    {p.editing && <button onClick={() => p.editing!.onMove('pos', offset(p.from, 90, 10))}>Move start on map</button>}
    {p.editing && <button onClick={() => p.onTap(offset(p.from, bearing(p.from, p.pin), 70))}>Place ball stop</button>}
  </div>;
} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import { Play } from '../src/play/Play';
import { RoundDetail } from '../src/golf/RoundDetail';

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
  it('saves a chip explicitly, enters putts through the club button, and supports six putts', () => {
    f.state.bag.clubs = f.state.bag.clubs.filter(c => c.id !== 'pt'); // Putting stays available with a custom bag.
    fixAt(offset(hole.green.center, 180, 20));
    const view = render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    advance(); fixAt(hole.green.center); view.rerender(<Play roundId={id} />);
    expect(screen.getByRole('button', { name: /Save here/ })).toBeTruthy();
    expect(f.map.view).toBe('hole');
    fireEvent.click(screen.getByRole('button', { name: /Choose club/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Putter, enter putts' }));
    expect(current().holes[1].pendingShot).toBeTruthy();
    expect(current().holes[1].shots).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    fireEvent.click(screen.getByRole('button', { name: /Save here/ }));
    expect(current().holes[1].shots).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Choose club/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Putter, enter putts' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit putt count' }), { target: { value: '6' } });
    advance(); fireEvent.click(screen.getByRole('button', { name: 'Finish hole' }));
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
    expect(screen.queryByText(/Shot saved.*Edit/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hole 1, scorecard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit hole 1' }));
    expect(screen.getByRole('button', { name: 'Edit shot 1, Driver' })).toBeTruthy();
  });
  it('opens a missed shot in the same editor and lets the club change before saving', () => {
    const tee = hole.tees![current().teeId].pos;
    fixAt(offset(tee, 0, 90));
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit missed .*shot/ }));
    expect(screen.getByRole('dialog', { name: 'Edit hole 1' })).toBeTruthy();
    expect(current().holes[1]).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Change shot club' }));
    fireEvent.click(screen.getByRole('button', { name: 'LW, stock 75 yards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(current().holes[1].shots[0]).toMatchObject({ club: 'lw', pos: tee, end: f.fix!.pos, origin: 'recovered' });
    expect(screen.queryByRole('button', { name: /Edit missed .*shot/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    expect(current().holes[1].pendingShot).toBeUndefined();
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit shot 1, Driver' })[0]);
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
    fireEvent.click(screen.getByRole('button', { name: 'Hole 1, scorecard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit hole 1' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add shot' }));
    expect(screen.getByRole('button', { name: 'All shots' })).toBeTruthy(); // Missing GPS still has a route back to the overview.
    act(() => { f.state = { ...f.state, rounds: { [id]: { ...current(), holes: { 1: { ...emptyHole(), penalties: 1, log: ['pen'] } } } } }; f.listeners.forEach(cb => cb()); });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert').textContent).toMatch(/This hole changed/);
    expect(current().holes[1].penalties).toBe(1);
    expect(current().holes[1].shots).toHaveLength(0);
  });
  it('keeps the top widget to three distinct navigation and scorecard buttons', () => {
    render(<Play roundId={id} />);
    const nav = screen.getByRole('navigation', { name: 'Hole navigation' });
    expect(within(nav).getAllByRole('button')).toHaveLength(3);
    expect(nav.textContent).toContain('Par 4');
    expect(nav.textContent).not.toMatch(/thru|White tees/);
    expect(screen.queryByRole('button', { name: /Add shot manually|Add short shot|Hole tools/ })).toBeNull();
    expect(f.map).not.toHaveProperty('onLongPress');
    fireEvent.click(screen.getByRole('button', { name: 'Previous hole, 18' }));
    expect(current().current).toBe(18);
    fireEvent.click(screen.getByRole('button', { name: 'Next hole, 1' }));
    expect(current().current).toBe(1);
  });
  it('recovers several missed shots by tapping remembered ball stops, without auto-saving a single long drive', () => {
    fixAt(hole.green.center);
    render(<Play roundId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Review missing shots/ }));
    expect(current().holes[1]).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Place ball stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place ball stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo last ball stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Place ball stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review shots' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const shots = current().holes[1].shots;
    expect(shots).toHaveLength(3);
    expect(shots[0].end).toEqual(shots[1].pos);
    expect(shots[1].end).toEqual(shots[2].pos);
    expect(shots[2].end).toEqual(hole.green.center);
    expect(shots[2].endAcc).toBe(3);
    expect(shots.every(s => s.origin === 'recovered')).toBe(true);
    expect(holeScore(current().holes[1])).toBe(3);
  });
  it('keeps tracking and shot editing to two primary buttons with a single-line save distance', () => {
    const view = render(<Play roundId={id} />);
    const bar = view.container.querySelector('[data-tracking-bar]')!;
    expect(within(bar as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Save.*putts|Shot saved/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Start shot/ }));
    advance(); fixAt(offset(f.fix!.pos, 0, 96 / 1.0936133)); view.rerender(<Play roundId={id} />);
    const save = screen.getByRole('button', { name: /Save here.*Tracking/ });
    expect(save.textContent).toBe('Save here · 96 yd');
    expect(save.querySelector('br')).toBeNull();
    expect(view.container.querySelector('[data-tracking-bar]')!.querySelectorAll('button')).toHaveLength(2);
  });
  it('opens a finished round directly in the same editable map and club/save row', async () => {
    const pos = hole.tees![current().teeId].pos;
    f.state.rounds[id] = { ...current(), done: true, current: 8, holes: { 1: { ...emptyHole(), completed: true, putts: 6, shots: [{ id: 'old', club: 'dr', pos, end: hole.green.center, acc: 3, t: clock, mishit: false }], log: ['shot', 'putt', 'putt', 'putt', 'putt', 'putt', 'putt'] } } };
    const view = render(<RoundDetail id={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit hole 1 · map & shots' }));
    await screen.findByRole('dialog', { name: 'Edit hole 1' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit shot 1, Driver' })[0]);
    expect(view.container.querySelector('[data-editor-bar]')!.querySelectorAll('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Change shot club' }));
    fireEvent.click(screen.getByRole('button', { name: 'PW, stock 125 yards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(current()).toMatchObject({ done: true, current: 8, holes: { 1: { completed: true, putts: 6 } } });
    expect(current().holes[1].shots[0].club).toBe('pw');
  });
});
