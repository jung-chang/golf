// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Alerts } from '../src/features/alerts/Alerts';
import { AlertSetupDialog } from '../src/features/alerts/AlertSetupDialog';
import { api } from '../src/lib/api';
import type { Criteria, TeeTime } from '../src/schemas/teetimes';

vi.mock('../src/lib/api', () => ({ api: vi.fn() }));
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, needsInstall: () => true, pushEnabled: async () => false, enablePush: vi.fn() }));
const criteria: Criteria = { dates: ['2026-10-20'], codes: ['CLR'], golfers: [2], holes18: true, window: [420, 660] };
const time: TeeTime = { code: 'CLR', facilityId: 4047, date: '2026-10-20', time: '08:00', teetime: '2026-10-20T12:00:00Z', spots: 4, holes: [18], priceCents: null };

beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ nextCheckAt: '2026-10-19T15:00:00Z' });
});
afterEach(cleanup);

describe('alert setup', () => {
  it('offers current results without creating an alert, and previews the selected server schedule', async () => {
    const close = vi.fn();
    render(<AlertSetupDialog open mode="create" criteria={criteria} visible={[time]} onOpenChange={close} />);
    expect(screen.getByRole('heading', { name: '1 matching tee time is available' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status', { name: 'Alert schedule' }).textContent).toContain('Next scheduled check:'));
    fireEvent.change(screen.getByLabelText('Check'), { target: { value: '1' } });
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/alerts/schedule', { body: { criteria, seen: [], weekdays: [], every: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: 'View available times' }));
    expect(close).toHaveBeenCalledWith(false);
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/alerts')).toBe(false);
  });

  it('saves existing results as seen even when phone push is unavailable', async () => {
    const close = vi.fn();
    render(<AlertSetupDialog open mode="create" criteria={criteria} visible={[time]} onOpenChange={close} />);
    expect(screen.getByText(/Phone notifications off. Add this app/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Watch for new openings' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/alerts', { body: { criteria, seen: ['4047|2026-10-20T12:00:00Z'], weekdays: [], every: 4 } }));
    expect(close).toHaveBeenCalledWith(false);
  });

  it('explains zero matches and schedule failures without claiming a check succeeded', async () => {
    vi.mocked(api).mockRejectedValue(new Error('offline'));
    render(<AlertSetupDialog open mode="create" criteria={criteria} onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'No matching times right now' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View available times' })).toBeNull();
    await screen.findByText('Schedule unavailable. Checks follow the selected frequency.');
  });
});

it('shows scheduled, paused, expired, and failed check states on saved alerts', async () => {
  const base = { criteria: { ...criteria, dates: ['2099-10-20'] }, seen: [], unread: [], weekdays: [], every: 4, paused: false, createdAt: '2026-10-17T12:00:00Z', checkedAt: null, nextCheckAt: '2099-10-19T15:00:00Z' };
  vi.mocked(api).mockResolvedValue([
    { ...base, id: 'first' },
    { ...base, id: 'paused', paused: true, nextCheckAt: null },
    { ...base, id: 'expired', criteria: { ...criteria, dates: ['2000-01-01'] }, nextCheckAt: null },
    { ...base, id: 'failed', checkFailed: true, checkedAt: '2026-10-16T15:00:00Z' },
  ]);
  render(<Alerts />);
  await screen.findByText(/First check scheduled:/);
  expect(screen.getByText('Paused')).toBeTruthy();
  expect(screen.getByText('Expired')).toBeTruthy();
  expect(screen.getByText(/Couldn’t refresh all courses/)).toBeTruthy();
  expect(screen.getByText(/Last successful check:/)).toBeTruthy();
  expect(screen.getAllByText('Phone notifications off')).toHaveLength(4);
});
