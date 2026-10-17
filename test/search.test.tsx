// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dayLabel } from '../src/features/games/label';
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api', () => ({ api: apiMock, SIGNED_OUT: 'signed-out' }));
vi.mock('../src/lib/store', () => ({ useStore: () => false, load: async () => {}, sync: async () => {} }));

const dates = ['2026-10-17', '2026-10-18'];
const times = dates.flatMap(date => [
  { code: 'CLR', facilityId: 4047, date, time: '08:00', teetime: `${date}T12:00:00Z`, spots: 4, holes: [18], priceCents: 5000 },
  { code: 'CLR', facilityId: 4047, date, time: '15:00', teetime: `${date}T19:00:00Z`, spots: 4, holes: [9, 18], priceCents: 5000 },
  { code: 'CLR', facilityId: 4047, date, time: '09:00', teetime: `${date}T13:00:00Z`, spots: 2, holes: [9], priceCents: 3000 },
]);
const requests = () => apiMock.mock.calls.filter(([path]) => path.startsWith('/tee-times')).length;
async function mount() {
  const { TeeTimes } = await import('../src/features/teetimes/TeeTimes');
  const { useHash } = await import('../src/lib/nav');
  function SearchApp() { return <TeeTimes view={useHash() === 'results' ? 'results' : 'search'} alerts={0} />; }
  return render(<SearchApp />);
}
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit search parameters' }));
async function search() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find tee times' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Find tee times' }));
  await screen.findAllByRole('button', { name: /8:00am.*Clearview/ });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T16:00:00Z'));
  localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  apiMock.mockReset().mockImplementation(async path => {
    if (path === '/me') return { email: 'golfer@example.test', name: 'Golfer', homeCourse: 'CLR' };
    if (path === '/games') return [];
    if (path.startsWith('/tee-times')) return { times, fetched: {}, errors: [] };
    return {};
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('compact tee time search', () => {
  it('starts collapsed with the next weekend, four players and a full day; retains the course grid', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Edit search parameters' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText(/4 players · 18 H · Full day/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Course selection' })).toBeTruthy();
    edit();
    expect(Reflect.get(screen.getByRole('checkbox', { name: dayLabel(dates[0]) }), 'checked')).toBe(true);
    expect(Reflect.get(screen.getByRole('checkbox', { name: dayLabel(dates[1]) }), 'checked')).toBe(true);
    expect(screen.queryByRole('combobox')).toBeNull();
    await search();
    expect(screen.getByRole('button', { name: 'Edit search parameters' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Course selection' })).toBeNull();
    expect(screen.getAllByRole('region', { name: /tee times$/ })).toHaveLength(2);
  });

  it('filters cached times immediately, but keeps holes and players pending until an explicit search', async () => {
    await mount(); await search(); const fetched = requests(); edit();
    screen.getByRole('slider', { name: 'End time' }).focus();
    for (let i = 0; i < 32; i++) fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'ArrowLeft' });
    expect(screen.queryByRole('button', { name: /3:00pm.*Clearview/ })).toBeNull();
    expect(requests()).toBe(fetched);
    expect(screen.queryByRole('button', { name: 'Search with new parameters' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '9 holes' }));
    fireEvent.click(screen.getByRole('radio', { name: '2 players' }));
    expect(screen.getByRole('button', { name: 'Search with new parameters' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /8:00am.*Clearview/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /9:00am.*Clearview/ })).toBeNull();
    expect(requests()).toBe(fetched);
    fireEvent.click(screen.getByRole('button', { name: 'Search with new parameters' }));
    await screen.findAllByRole('button', { name: /9:00am.*Clearview/ });
    expect(screen.queryByRole('button', { name: /8:00am.*Clearview/ })).toBeNull();
    expect(requests()).toBe(fetched + 1);
    expect(screen.getByRole('button', { name: 'Edit search parameters' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('prevents empty-date searches, limits dates to three, and keeps loaded results while edits are pending', async () => {
    await mount(); await search(); edit();
    for (const d of dates) fireEvent.click(screen.getByRole('checkbox', { name: dayLabel(d) }));
    expect(screen.getByRole('alert').textContent).toContain('Choose at least one date');
    expect(screen.getByRole('button', { name: 'Search with new parameters' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByRole('button', { name: /8:00am.*Clearview/ })).toHaveLength(2);
    for (const d of [...dates, '2026-10-19']) fireEvent.click(screen.getByRole('checkbox', { name: dayLabel(d) }));
    expect(screen.getByRole('checkbox', { name: dayLabel('2026-10-20') }).hasAttribute('disabled')).toBe(true);
  });

  it('restores the applied search and time filter after a reload', async () => {
    let view = await mount(); await search(); edit();
    screen.getByRole('slider', { name: 'End time' }).focus();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'ArrowLeft' });
    const saved = JSON.parse(sessionStorage.getItem('golf.teetimes.results')!);
    expect(saved.last.window).toEqual([300, 1185]);
    expect(saved.last.holes).toBe(18);
    view.unmount(); vi.resetModules();
    view = await mount();
    expect(screen.getByRole('button', { name: 'Edit search parameters' }).getAttribute('aria-expanded')).toBe('false');
    edit();
    expect(screen.getByRole('slider', { name: 'End time' }).getAttribute('aria-valuetext')).toBe('7:45pm');
    expect(screen.getAllByRole('button', { name: /8:00am.*Clearview/ })).toHaveLength(2);
    view.unmount();
  });
});
