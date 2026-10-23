// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultBag } from '../src/lib/clubs';
import { newRound, emptyHole, markShot, holeDone } from '../src/lib/round';
import { getCourse } from '../src/lib/courses';
import type { Round } from '../src/schemas/round';
import type { Fix } from '../src/play/useGeolocation';

const fixture = vi.hoisted(() => ({
  state: { rounds: {} as Record<string, Round>, bag: {} as ReturnType<typeof defaultBag>, owner: 'golfer@example.test', loaded: true, initialSynced: false, syncStatus: 'pending', activeId: null, pending: 0 },
  member: { email: 'golfer@example.test', name: 'Golfer', homeCourse: 'CLR', handicap: 12.4 as number | null, showHandicap: false, notifyGames: true },
  failGames: false,
  fix: null as Fix | null,
}));
const apiMock = vi.hoisted(() => vi.fn());
const saveRoundMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api', () => ({ api: apiMock, SIGNED_OUT: 'signed-out', ACCOUNT_CHANGED: 'account-changed' }));
vi.mock('../src/lib/store', () => ({ useStore: (select: (s: typeof fixture.state) => unknown) => select(fixture.state), load: vi.fn(async () => {}), sync: vi.fn(async () => {}), setActive: vi.fn(), startRound: vi.fn(), saveRound: saveRoundMock }));
vi.mock('../src/play/HoleMap', () => ({ HoleMap: () => <div aria-label="Course map" />, labelAt: vi.fn() }));
vi.mock('../src/play/useGeolocation', () => ({ useGeolocation: () => ({ fix: fixture.fix, error: fixture.fix ? null : 'Location permission denied', inject: vi.fn() }), useWakeLock: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', async (orig) => ({ ...(await orig<typeof import('sonner')>()), toast: toastMock }));
vi.mock('../src/lib/elevation', () => ({ elevationFt: async () => null, playsLike: (yards: number) => yards }));
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, pushEnabled: async () => false, needsInstall: () => false, enablePush: vi.fn(), disablePush: vi.fn() }));
vi.mock('../src/lib/theme', () => ({ useTheme: () => 'light', useResolvedTheme: () => 'light', setTheme: vi.fn() }));
import { Profile } from '../src/features/profile/Profile';
import { Games } from '../src/features/games/Games';
import { Play } from '../src/play/Play';

beforeEach(() => {
  fixture.state = { rounds: {}, bag: defaultBag(), owner: fixture.member.email, loaded: true, initialSynced: false, syncStatus: 'pending', activeId: null, pending: 0 };
  fixture.member.handicap = 12.4;
  fixture.failGames = false;
  fixture.fix = null;
  saveRoundMock.mockClear();
  apiMock.mockReset().mockImplementation(async (path, init) => {
    if (path === '/me') {
      if (init?.method === 'PUT') fixture.member = { ...fixture.member, ...init.body };
      return { ...fixture.member };
    }
    if (path === '/members') return [{ ...fixture.member }];
    if (path.startsWith('/games')) {
      if (fixture.failGames) throw new Error('Unavailable');
      return [];
    }
    return {};
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('profile and game recovery', () => {
  it('does not erase a saved handicap while the first round sync is incomplete', async () => {
    render(<Profile />);
    await screen.findByRole('button', { name: /Golfer.*Edit/ });
    await act(async () => {});
    expect(apiMock.mock.calls.filter(([path, init]) => path === '/me' && init?.method === 'PUT')).toHaveLength(0);
    expect(screen.getAllByText('12.4').length).toBeGreaterThan(0);
  });
  it('publishes an estimate only after complete synced history is available', async () => {
    const view = render(<Profile />);
    await screen.findByRole('button', { name: /Golfer.*Edit/ });
    const course = getCourse('clearview-park')!;
    const base = newRound(course, course.tees[0].id);
    fixture.state = { ...fixture.state, initialSynced: true, syncStatus: 'synced', rounds: Object.fromEntries([1, 2, 3].map((n) => {
      const round = { ...base, id: `round-${n}`, done: true, date: `2026-10-0${n}T12:00:00.000Z`,
        holes: Object.fromEntries(Object.entries(base.pars).map(([hole, par]) => [hole, { ...emptyHole(), putts: 2, adj: par - 1 }])) };
      return [round.id, round];
    })) };
    view.rerender(<Profile />);
    await waitFor(() => expect(apiMock.mock.calls.some(([path, init]) => path === '/me' && init?.method === 'PUT' && typeof init.body.handicap === 'number' && init.member === fixture.member.email)).toBe(true));
  });
  it('replaces a failed game load with an inline retry that can recover', async () => {
    fixture.failGames = true;
    render(<Games />);
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Loading')).toBeNull();
    fixture.failGames = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Nothing planned');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('explains starting at the ball, measuring at the next ball, and undo', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const course = getCourse('clearview-park')!;
    const round = newRound(course, course.tees[0].id);
    fixture.state.rounds = { [round.id]: round };
    fixture.fix = { pos: [...course.holes[0].path![0]], acc: 2, t: Date.now() };
    const start = [...fixture.fix.pos];
    const view = render(<Play roundId={round.id} />);
    const refresh = () => {
      fixture.state.rounds = { [round.id]: saveRoundMock.mock.lastCall![0] };
      view.rerender(<Play roundId={round.id} />);
    };
    const guidance = () => screen.getByRole('status', { name: 'Shot guidance' }).textContent;
    expect(guidance()).toBe('');
    expect(screen.getByRole('button', { name: /Start shot ·/ }).textContent).toContain('#1');
    fireEvent.click(screen.getByRole('button', { name: /Start shot ·/ }));
    refresh();
    expect(screen.getByRole('status', { name: 'Shot guidance' }).textContent).toBe('');
    expect(screen.getByRole('button', { name: /Start shot ·/ }).textContent).toContain('#2');
    expect(fixture.state.rounds[round.id].holes[round.current].shots[0]).toMatchObject({ pos: start, end: null });
    clock.mockReturnValue(102_000);
    fixture.fix = { ...fixture.fix, pos: [fixture.fix.pos[0] + 0.0001, fixture.fix.pos[1]] };
    const nextBall = [...fixture.fix.pos];
    view.rerender(<Play roundId={round.id} />);
    fireEvent.click(screen.getByRole('button', { name: /Start shot ·/ }));
    refresh();
    const shots = fixture.state.rounds[round.id].holes[round.current].shots;
    expect(shots).toHaveLength(2);
    expect(shots[0].end).toEqual(nextBall);
    expect(shots[1].pos).toEqual(nextBall);
    expect(screen.getByLabelText('Last shot').textContent).toMatch(/^Driver · \d+ y$/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last action' }));
    refresh();
    expect(guidance()).toBe('Stroke removed');
    expect(screen.getByRole('button', { name: 'Save correction · Driver' })).toBeTruthy();
    expect(fixture.state.rounds[round.id].holes[round.current].shots[0].end).toBeNull();
  });
  it('finishes a hole from the putt count, ends the approach where you stand, and moves on', async () => {
    const course = getCourse('clearview-park')!;
    const round = markShot(newRound(course, course.tees[0].id), '7i', course.holes[0].path![0], 2);
    fixture.state.rounds = { [round.id]: round };
    const green = [...course.holes[0].green.center] as [number, number];
    fixture.fix = { pos: green, acc: 3, t: Date.now() };
    render(<Play roundId={round.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Putts (finishes the hole)' }));
    fireEvent.click(await screen.findByRole('button', { name: '2 putts' }));
    const saved = saveRoundMock.mock.lastCall![0];
    expect(saved.holes[1]).toMatchObject({ putts: 2, completed: true });
    expect(saved.holes[1].shots[0].end).toEqual(green);
    expect(saved.current).toBe(course.holes[1].number);
    expect(toastMock.success).toHaveBeenLastCalledWith(expect.stringMatching(/^Hole 1: 3 strokes · Birdie · approach 7i \d+ y$/));
  });
  it('leaves the approach unmeasured when putts are entered away from the green', async () => {
    const course = getCourse('clearview-park')!;
    const round = markShot(newRound(course, course.tees[0].id), '7i', course.holes[0].path![0], 2);
    fixture.state.rounds = { [round.id]: round };
    fixture.fix = { pos: [...course.holes[1].tees!.white.pos], acc: 3, t: Date.now() }; // walked to the next tee
    render(<Play roundId={round.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Putts (finishes the hole)' }));
    fireEvent.click(await screen.findByRole('button', { name: '2 putts' }));
    expect(saveRoundMock.mock.lastCall![0].holes[1]).toMatchObject({ putts: 2, completed: true });
    expect(saveRoundMock.mock.lastCall![0].holes[1].shots[0].end).toBeNull();
    expect(toastMock.success).toHaveBeenLastCalledWith('Hole 1: 3 strokes · Birdie');
  });
  it('restores saved yardage after walking, survives remount, and corrects without moving the shot', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const course = getCourse('clearview-park')!;
    const round = newRound(course, course.tees[0].id);
    fixture.state.rounds = { [round.id]: round };
    fixture.fix = { pos: [...course.holes[0].path![0]], acc: 2, t: 99_000 };
    const original = [...fixture.fix.pos];
    let view = render(<Play roundId={round.id} />);
    const originalYards = view.container.querySelector('.text-6xl')!.textContent;
    const refresh = () => {
      fixture.state.rounds = { [round.id]: saveRoundMock.mock.lastCall![0] };
      view.rerender(<Play roundId={round.id} />);
    };
    fireEvent.click(screen.getByRole('button', { name: /Start shot ·/ }));
    refresh();
    fireEvent.click(screen.getByRole('button', { name: /Start shot ·/ }));
    expect(saveRoundMock).toHaveBeenCalledTimes(1); // accidental double tap
    fixture.fix = { pos: [...course.holes[0].green.center], acc: 5, t: 110_000 };
    clock.mockReturnValue(110_000);
    view.rerender(<Play roundId={round.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo last action' }));
    refresh();
    expect(view.container.querySelector('.text-6xl')!.textContent).toBe(originalYards);
    view.unmount();
    view = render(<Play roundId={round.id} />);
    expect(view.container.querySelector('.text-6xl')!.textContent).toBe(originalYards);
    fireEvent.click(screen.getByRole('button', { name: /^Change club/ }));
    fireEvent.click(screen.getByRole('button', { name: /^7i/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save correction · 7 Iron' }));
    refresh();
    expect(fixture.state.rounds[round.id].holes[round.current].shots[0]).toMatchObject({ pos: original, acc: 2, t: 100_000, club: '7i' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo last action' }));
    refresh();
    fireEvent.click(screen.getByRole('button', { name: 'Use live GPS' }));
    refresh();
    expect(fixture.state.rounds[round.id].holes[round.current].correction).toBeUndefined();
    expect(view.container.querySelector('.text-6xl')!.textContent).toBe('0');
  });
  it('keeps putting and hole tools usable when GPS permission is denied', async () => {
    const course = getCourse('clearview-park')!;
    const round = newRound(course, course.tees[0].id);
    fixture.state.rounds = { [round.id]: round };
    render(<Play roundId={round.id} />);
    await screen.findByText(/GPS: Location permission denied/);
    fireEvent.click(screen.getByRole('button', { name: 'Putts (finishes the hole)' }));
    fireEvent.click(await screen.findByRole('button', { name: '1 putt' }));
    expect(saveRoundMock.mock.lastCall?.[0].holes[round.current].putts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hole tools and penalties' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Add a penalty stroke' }));
    expect(saveRoundMock.mock.lastCall?.[0].holes[round.current].penalties).toBe(1);
    expect(screen.getByRole('button', { name: 'Close sheet' })).toBeTruthy();
  });
  it('shows the round on a scorecard from the hole name and jumps to a hole from it', async () => {
    const course = getCourse('clearview-park')!;
    let round = markShot(newRound(course, course.tees[0].id), 'dr', course.holes[0].path![0], 2);
    round = holeDone({ ...round, holes: { ...round.holes, 1: { ...round.holes[1], putts: 4 } } }, course.holes[0].green.center);
    round = { ...round, current: course.holes[1].number };
    fixture.state.rounds = { [round.id]: round };
    render(<Play roundId={round.id} />);
    const pill = screen.getByRole('button', { name: 'Hole 2, +1 thru 1, scorecard' });
    expect(pill.textContent).toContain('+1 thru 1');
    fireEvent.click(pill);
    await screen.findByRole('table', { name: 'Front nine' });
    expect(screen.getByRole('button', { name: 'Hole 1, 5' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hole 7' }));
    expect(saveRoundMock.mock.lastCall![0].current).toBe(7);
  });
  it('keeps a completed hole review available after moving to the next tee', () => {
    const course = getCourse('clearview-park')!;
    let round = markShot(newRound(course, course.tees[0].id), 'dr', course.holes[0].path![0], 2);
    round = holeDone(round, course.holes[0].green.center);
    round = { ...round, current: course.holes[1].number };
    fixture.state.rounds = { [round.id]: round };
    render(<Play roundId={round.id} />);
    expect(screen.getByRole('button', { name: /Start shot ·/ }).textContent).toContain('#1');
    fireEvent.click(screen.getByRole('button', { name: 'Hole tools and penalties' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review hole 1 · shots & yardages' }));
    expect(screen.getByRole('dialog', { name: 'Hole 1 · Par 4' })).toBeTruthy();
    expect(screen.getByText(/Hole complete/)).toBeTruthy();
    expect(saveRoundMock).not.toHaveBeenCalled();
  });
});
