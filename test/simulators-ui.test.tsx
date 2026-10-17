// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Simulators } from '../src/features/simulators/Simulators';
import { api } from '../src/lib/api';
import { nyToday } from '../src/lib/nyc';

vi.mock('../src/lib/api', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('simulator booking handoff', () => {
  it('filters real results locally and reviews terms before handing off, without booking', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const date = nyToday();
    vi.mocked(api).mockReset().mockResolvedValue({ fetchedAt: new Date().toISOString(), failedDates: [], slots: [
      { date, time: '10:00', utc: `${date}T14:00:00Z`, duration: 60, rate: '$99/Hour (Peak Golf)', cancellation: 'Cancel at least 24 hours before.', cardRequired: true },
      { date, time: '20:00', utc: `${date}T00:00:00Z`, duration: 60, rate: '$49/Hour (Special)', cancellation: '', cardRequired: true },
    ] });
    render(<Simulators />);
    fireEvent.click(screen.getByRole('button', { name: 'Find simulator times' }));
    await screen.findByRole('button', { name: /10:00am.*Peak Golf/ });
    screen.getByRole('slider', { name: 'End time' }).focus();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'PageDown' });
    expect(screen.queryByRole('button', { name: /8:00pm.*Special/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End time' }), { key: 'End' });
    fireEvent.click(screen.getByRole('button', { name: /10:00am.*Peak Golf/ }));
    expect(screen.getByRole('heading', { name: 'Review your bay request' })).toBeTruthy();
    expect(screen.getByText('A credit card is required by the venue.')).toBeTruthy();
    expect(screen.getByText(/No reservation yet/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Continue to SevenRooms' });
    expect(link.getAttribute('href')).toContain('start_time=10%3A00');
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to times' }));
    fireEvent.change(screen.getByLabelText('Guests'), { target: { value: '4' } });
    expect(screen.queryByRole('button', { name: /10:00am.*Peak Golf/ })).toBeNull();
  });
});
