// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingUrl, courseByCode, NYC_COURSES } from '../src/lib/nyc';
import { clearBooking, openBooking, pendingBooking } from '../src/features/games/booking';

afterEach(() => { clearBooking(); vi.restoreAllMocks(); });

describe('booking destinations', () => {
  it.each([
    ['CLR', 'golf-nyc', '4047'],
    ['DGL', 'golf-nyc', '5044'],
    ['VCT', 'golf-nyc', '5043'],
    ['FLU', 'golf-nyc', '16016'],
    ['KIS', 'golf-nyc', '5046'],
    ['FOR', 'golf-nyc', '5045'],
    ['SLV', 'golf-nyc', '4757'],
    ['SSO', 'golf-nyc', '4051'],
    ['LTO', 'golf-nyc', '4049'],
    ['PEL', 'pelham-bay-split-rock', '4111'],
    ['SPL', 'pelham-bay-split-rock', '19264'],
    ['DYK', 'dyker-beach-golf-course', '4048'],
    ['MPK', 'marine-park-golf-course', '4857'],
  ])('opens %s on its own dated tee sheet', (code, tenant, facility) => {
    const url = new URL(bookingUrl(courseByCode(code)!, '2026-10-20')!);
    expect(url.origin).toBe(`https://${tenant}.book.teeitup.com`);
    expect(url.pathname).toBe('/teetimes');
    expect(url.searchParams.get('course')).toBe(facility);
    expect(url.searchParams.get('date')).toBe('2026-10-20');
  });

  it('opens the same destination from search or a group game and retains the requested time', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const request = { code: 'SPL', date: '2026-10-20', time: '09:30', teetime: '2026-10-20T13:30:00.000Z' };
    for (const gameId of [undefined, 'example-game']) {
      openBooking({ ...request, gameId });
      expect(open).toHaveBeenLastCalledWith('https://pelham-bay-split-rock.book.teeitup.com/teetimes?course=19264&date=2026-10-20', '_blank', 'noopener');
      expect(pendingBooking()).toMatchObject(request);
      expect(pendingBooking()?.gameId).toBe(gameId);
    }
  });

  it('does not create a phantom booking confirmation when no booking destination exists', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(bookingUrl(courseByCode('MOS')!, '2026-10-20')).toBeUndefined();
    expect(NYC_COURSES.filter(c => c.tenant)).toHaveLength(13);
    openBooking({ code: 'MOS', date: '2026-10-20', time: '09:30', teetime: '2026-10-20T13:30:00.000Z' });
    expect(open).not.toHaveBeenCalled();
    expect(pendingBooking()).toBeNull();
  });
});
