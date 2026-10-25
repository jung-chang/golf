// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultBag } from '../src/lib/clubs';
import { newRound, emptyHole } from '../src/lib/round';
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
vi.mock('../src/play/HoleMap', () => ({ HoleMap: (p: { pinCallout?: React.ReactNode }) => <div aria-label="Course map">{p.pinCallout}</div>, labelAt: vi.fn() }));
vi.mock('../src/play/useGeolocation', () => ({ useGeolocation: () => ({ fix: fixture.fix, error: fixture.fix ? null : 'Location permission denied', inject: vi.fn() }), useWakeLock: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', async (orig) => ({ ...(await orig<typeof import('sonner')>()), toast: toastMock }));
vi.mock('../src/lib/elevation', () => ({ elevationFt: async () => null, playsLike: (yards: number) => yards }));
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, pushEnabled: async () => false, needsInstall: () => false, enablePush: vi.fn(), disablePush: vi.fn() }));
vi.mock('../src/lib/theme', () => ({ useTheme: () => 'light', useResolvedTheme: () => 'light', setTheme: vi.fn() }));
import { Profile } from '../src/features/profile/Profile';
import { Games } from '../src/features/games/Games';


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
});

describe('opening golf with no server answer', () => {
  it('offers the saved copy of the account last signed in on this phone', async () => {
    const { LoadError } = await import('../src/components/data-status');
    render(<LoadError message="Can't reach the server. Your round is saved on this phone." savedMember="kevin@example.test" />);
    expect(screen.getByRole('button', { name: "Open kevin's saved golf" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
