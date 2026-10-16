// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { addDays, nyToday } from '../src/lib/nyc';
import { useHash } from '../src/lib/nav';
import { dayLabel } from '../src/features/games/label';
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api', () => ({ api: apiMock, SIGNED_OUT: 'signed-out' }));
vi.mock('../src/lib/store', () => ({ useStore: () => false, load: async () => {}, sync: async () => {} }));
import { TeeTimes } from '../src/features/teetimes/TeeTimes';

function SearchApp() {
  const hash = useHash();
  return <TeeTimes view={hash === 'results' ? 'results' : 'search'} alerts={0} />;
}
afterEach(() => cleanup());

describe('tee time search', () => {
  it('uses the chosen hours, changes results by date, and remembers the search for booking return', async () => {
    const today = nyToday();
    const tomorrow = addDays(today, 1);
    const times = [
      { code: 'CLR', facilityId: 4047, date: today, time: '08:00', teetime: `${today}T12:00:00Z`, spots: 3, holes: [18], priceCents: 5000 },
      { code: 'CLR', facilityId: 4047, date: tomorrow, time: '10:00', teetime: `${tomorrow}T14:00:00Z`, spots: 1, holes: [18], priceCents: 5000 },
      { code: 'CLR', facilityId: 4047, date: today, time: '15:00', teetime: `${today}T19:00:00Z`, spots: 4, holes: [18], priceCents: 5000 },
    ];
    apiMock.mockImplementation(async (path) => {
      if (path === '/me') return { email: 'golfer@example.test', name: 'Golfer', homeCourse: 'CLR' };
      if (path === '/games') return [];
      if (path.startsWith('/tee-times')) return { times, fetched: {}, errors: [] };
      return {};
    });
    history.replaceState(null, '', '/');
    render(<SearchApp />);
    fireEvent.click(screen.getByRole('button', { name: /^Today,/ }));
    fireEvent.click(screen.getByRole('button', { name: dayLabel(tomorrow) }));
    fireEvent.click(screen.getByRole('button', { name: 'Morning' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find tee times' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Find tee times' }));
    await screen.findByRole('button', { name: /8:00am.*Clearview/ });
    expect(screen.queryByRole('button', { name: /3:00pm.*Clearview/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /10:00am.*Clearview/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${dayLabel(tomorrow)}, 1 tee times` }));
    await screen.findByRole('button', { name: /10:00am.*Clearview/ });
    expect(screen.queryByRole('button', { name: /8:00am.*Clearview/ })).toBeNull();
    const saved = JSON.parse(sessionStorage.getItem('golf.teetimes.results')!);
    expect(saved.last.window).toEqual([300, 720]);
    expect(saved.selectedDate).toBe(tomorrow);
    expect(saved.last.codes).toEqual(['CLR']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit search' }));
    await screen.findByRole('heading', { name: 'Time of day' });
    expect(screen.getByRole('button', { name: 'Morning' }).getAttribute('aria-pressed')).toBe('true');
  });
});
