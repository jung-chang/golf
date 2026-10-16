// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultBag } from '../src/lib/clubs';
import { getCourse } from '../src/lib/courses';
import { offset } from '../src/lib/geo';
import { reviewDistance, reviewStrokes } from '../src/lib/hole-review';
import * as R from '../src/lib/round';

const mapProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../src/play/HoleMap', () => ({
  HoleMap: (props: Record<string, unknown>) => { mapProps.current = props; return <div aria-label="Recorded hole map" />; },
  labelAt: (from: unknown, _to: unknown, text: string) => ({ pos: from, text }),
}));
import { HoleReview } from '../src/play/HoleReview';

const course = getCourse('clearview-park')!;
const hole = course.holes[0];
const tee = hole.path![0];
const fairway = offset(tee, 180, 200);
const green = hole.green.center;
const bag = defaultBag();
const fixture = () => {
  let r = R.markShot(R.newRound(course, course.tees[0].id), 'dr', tee, 2);
  r = R.markShot(r, '7i', fairway, 2);
  r = R.putt(r, green, 2);
  r = R.putt(r, offset(green, 90, 2), 2);
  return R.holeDone(r, green).holes[hole.number];
};
afterEach(cleanup);

describe('hole replay', () => {
  it('replays shots and putts without inventing the final putt endpoint', () => {
    const strokes = reviewStrokes(fixture(), bag);
    expect(strokes.map(s => s.label)).toEqual(['Driver', '7 Iron', 'Putter · putt 1', 'Putter · putt 2']);
    expect(strokes[0].yards).toBeCloseTo(200 * 1.0936133, 2);
    expect(strokes[1].end).toEqual(green);
    expect(strokes[2].end).not.toBeNull();
    expect(strokes[3].end).toBeNull();
    expect(reviewDistance(strokes[3])).toBe('Finish not recorded');
  });
  it('distinguishes estimated hole-outs, penalties, manual scores, and absent GPS', () => {
    let r = R.markShot(R.newRound(course, course.tees[0].id), 'pw', tee, 2);
    r = R.penalty(r);
    r = R.holeDone(r, green);
    const entries = reviewStrokes(r.holes[hole.number], bag);
    expect(reviewDistance(entries[0])).toContain('estimated finish');
    expect(reviewDistance(entries[1])).toBe('Added to score');
    const noGps = R.putt(R.newRound(course, course.tees[0].id), null).holes[hole.number];
    expect(reviewDistance(reviewStrokes(noGps, bag)[0])).toBe('Position not recorded');
    expect(reviewStrokes({ ...R.emptyHole(), adj: 2 }, bag)).toHaveLength(0);
  });
  it('shows all measured lines and allows individual stroke playback without writing round data', () => {
    const state = fixture(), original = JSON.stringify(state);
    const close = vi.fn();
    render(<HoleReview hole={hole} state={state} bag={bag} onClose={close} />);
    expect(screen.getByText('Hole 1 · Par 4')).toBeTruthy();
    expect(mapProps.current.review).toBe(true);
    expect(mapProps.current.shotLines).toHaveLength(3);
    expect(mapProps.current.here).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next stroke' }));
    expect(screen.getByRole('status', { name: 'Replay position' }).textContent).toContain('Stroke 1 of 4 · Driver');
    expect(mapProps.current.shotLines).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Previous stroke' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next stroke' }));
    expect(screen.getByRole('status', { name: 'Replay position' }).textContent).toContain('7 Iron');
    fireEvent.click(screen.getByRole('button', { name: /Stroke 4: Putter/ }));
    expect(mapProps.current.shotLines).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Next stroke' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Whole hole' }));
    expect(mapProps.current.shotLines).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    expect(close).toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(original);
  });
});
