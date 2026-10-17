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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('tee time search', () => {
  it('compares at most two dates, filters immediately with the inline slider, and remembers booking-return filters', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const today = nyToday();
    const tomorrow = addDays(today, 1);
    const third = addDays(today, 2);
    const times = [
      { code: 'CLR', facilityId: 4047, date: today, time: '08:00', teetime: `${today}T12:00:00Z`, spots: 3, holes: [18], priceCents: 5000 },
      { code: 'CLR', facilityId: 4047, date: tomorrow, time: '10:00', teetime: `${tomorrow}T14:00:00Z`, spots: 1, holes: [18], priceCents: 5000 },
      { code: 'CLR', facilityId: 4047, date: today, time: '15:00', teetime: `${today}T19:00:00Z`, spots: 4, holes: [18], priceCents: 5000 },
      { code: 'CLR', facilityId: 4047, date: third, time: '09:00', teetime: `${third}T13:00:00Z`, spots: 2, holes: [18], priceCents: 5000 },
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
    fireEvent.click(screen.getByRole('button', { name: dayLabel(third) }));
    fireEvent.click(screen.getByRole('button', { name: 'Morning' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find tee times' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Find tee times' }));
    await screen.findByRole('button', { name: /8:00am.*Clearview/ });
    expect(screen.queryByRole('button', { name: /3:00pm.*Clearview/ })).toBeNull();
    await screen.findByRole('button', { name: /10:00am.*Clearview/ });
    expect(screen.getAllByRole('region', { name: /tee times$/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: `${dayLabel(third)}, 1 tee times` }).hasAttribute('disabled')).toBe(false);
    const requests = apiMock.mock.calls.filter(([path]) => path.startsWith('/tee-times')).length;
    screen.getByRole('slider', { name: 'End time' }).focus();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'PageDown' });
    expect(screen.getByRole('slider', { name: 'End time' }).getAttribute('aria-valuetext')).toBe('9:30am');
    expect(screen.queryByRole('button', { name: /10:00am.*Clearview/ })).toBeNull();
    expect(screen.getByRole('button', { name: /8:00am.*Clearview/ })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'End' });
    expect(screen.getByRole('button', { name: /3:00pm.*Clearview/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `${dayLabel(third)}, 1 tee times` }));
    expect(screen.getByRole('button', { name: /8:00am.*Clearview/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /10:00am.*Clearview/ })).toBeNull();
    expect(screen.getByRole('button', { name: /9:00am.*Clearview/ })).toBeTruthy();
    expect(screen.getAllByRole('region', { name: /tee times$/ })).toHaveLength(2);
    expect(screen.getByText('First 10:00am')).toBeTruthy(); // unshown day remains summarized
    fireEvent.change(screen.getByRole('combobox', { name: 'Left column day' }), { target: { value: third } });
    expect(screen.getByRole('combobox', { name: 'Right column day' }).getAttribute('aria-label')).toBe('Right column day');
    expect(Reflect.get(screen.getByRole('combobox', { name: 'Left column day' }), 'value')).toBe(third);
    expect(Reflect.get(screen.getByRole('combobox', { name: 'Right column day' }), 'value')).toBe(today);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Left column day' }));
    fireEvent.click(screen.getByRole('button', { name: `${dayLabel(tomorrow)}, 1 tee times` }));
    expect(apiMock.mock.calls.filter(([path]) => path.startsWith('/tee-times'))).toHaveLength(requests);
    const saved = JSON.parse(sessionStorage.getItem('golf.teetimes.results')!);
    expect(saved.last.window).toEqual([300, 1200]);
    expect(saved.visibleDates).toEqual([tomorrow, today]);
    expect(saved.last.codes).toEqual(['CLR']);
    fireEvent.click(screen.getByRole('button', { name: `${dayLabel(tomorrow)}, 1 tee times` }));
    expect(screen.getAllByRole('region', { name: /tee times$/ })).toHaveLength(2); // tapping a shown day selects its replacement column
    fireEvent.click(screen.getByRole('button', { name: 'Edit search' }));
    await screen.findByRole('heading', { name: 'Time of day' });
    expect(screen.getByRole('button', { name: 'Any time' }).getAttribute('aria-pressed')).toBe('true');
  });
});
