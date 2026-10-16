import { describe, expect, it } from 'vitest';
import courseJson from '../courses/clearview-park.json';
import { offset, type LngLat } from '../src/lib/geo';
import * as R from '../src/lib/round';
import { Course } from '../src/schemas/course';
import { Round } from '../src/schemas/round';

const course = Course.parse(courseJson);
const tee: LngLat = [-73.789, 40.786];

describe('round actions', () => {
  it('measures shots from where the next one is hit, then putts', () => {
    let r = R.newRound(course, 'black');
    const fairway = offset(tee, 180, 220);
    const green = offset(tee, 180, 310);
    r = R.markShot(r, 'dr', tee, 4);
    r = R.markShot(r, '9i', fairway, 4);
    r = R.putt(r, green);
    r = R.putt(r, green);
    const h = r.holes[1];
    expect(h.shots[0].end).toEqual(fairway);
    expect(h.shots[1].end).toEqual(green);
    expect(R.holeScore(h)).toBe(4);
    expect(Round.safeParse(r).success).toBe(true);
  });

  it('undo reverses each step, including the shot end it set', () => {
    let r = R.newRound(course, 'black');
    r = R.markShot(r, 'dr', tee, 4);
    r = R.markShot(r, '9i', offset(tee, 180, 220), 4);
    r = R.undo(r);
    expect(r.holes[1].shots).toHaveLength(1);
    expect(r.holes[1].shots[0].end).toBeNull();
    r = R.putt(r, offset(tee, 180, 300));
    r = R.undo(r);
    expect(r.holes[1].putts).toBe(0);
    expect(r.holes[1].shots[0].end).toBeNull();
  });

  it('holing out with no putts ends the last shot at the pin', () => {
    const pin = course.holes[0].green.center;
    let r = R.markShot(R.newRound(course, 'black'), 'pw', tee, 4);
    r = R.holeDone(r, pin);
    expect(r.holes[1].shots[0].end).toEqual(pin);
  });
});
