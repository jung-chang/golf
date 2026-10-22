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

  it('corrects a club after walking without changing either shot position or capture quality', () => {
    const fairway = offset(tee, 180, 220);
    const walked = offset(tee, 180, 290);
    let r = R.markShot(R.newRound(course, 'black'), 'dr', tee, 4);
    r = R.markShot(r, '9i', fairway, 3);
    const captured = r.holes[1].shots[1];
    r = R.undo(r);
    r = Round.parse(JSON.parse(JSON.stringify(r))); // persisted recovery survives reload
    r = R.markShot(r, '7i', walked, 20);
    expect(r.holes[1].shots).toHaveLength(2);
    expect(r.holes[1].shots[0].end).toEqual(fairway);
    expect(r.holes[1].shots[1]).toEqual({ ...captured, club: '7i' });
    expect(r.holes[1].correction).toBeUndefined();
  });

  it('restores the first putt position after walking and keeps later putts from moving the approach endpoint', () => {
    const green = offset(tee, 180, 310), walked = offset(green, 90, 5);
    let r = R.markShot(R.newRound(course, 'black'), 'pw', tee, 3);
    r = R.putt(r, green, 2, 100_000);
    r = R.undo(r);
    expect(r.holes[1].shots[0].end).toBeNull();
    r = R.putt(r, walked, 10, 200_000);
    expect(r.holes[1].shots[0].end).toEqual(green);
    expect(r.holes[1].puttStarts![0]).toMatchObject({ pos: green, acc: 2, t: 100_000 });
    r = R.putt(r, walked, 3, 210_000);
    r = R.undo(r);
    r = R.putt(r, tee, 10);
    expect(r.holes[1].shots[0].end).toEqual(green);
    expect(r.holes[1].puttStarts![1]?.pos).toEqual(walked);
    expect(r.holes[1].putts).toBe(2);
  });

  it('can discard an extra tap and continue at the current ball, including older rounds without putt snapshots', () => {
    let r = R.markShot(R.newRound(course, 'black'), 'dr', tee, 4);
    r = R.undo(r);
    r = R.editHole(r, h => { delete h.correction; });
    const fairway = offset(tee, 180, 220);
    r = R.markShot(r, '7i', fairway, 3);
    expect(r.holes[1].shots[0].pos).toEqual(fairway);
    r = R.putt(r, fairway);
    r = R.undo(r);
    expect(r.holes[1].correction).toBeUndefined();
    expect(Round.safeParse(r).success).toBe(true);
  });
});

describe('setPutts', () => {
  it('finishes the hole with a putt count, ends the approach on the green, and can be corrected', () => {
    const tee = course.holes[0].path![0];
    const green = course.holes[0].green.center;
    let r = R.markShot(R.newRound(course, course.tees[0].id), 'dr', tee, 3);
    r = R.setPutts(r, 2, green, green);
    expect(r.holes[1]).toMatchObject({ putts: 2, completed: true });
    expect(r.holes[1].shots[0].end).toEqual(green);
    expect(R.holeScore(r.holes[1])).toBe(3);
    r = R.setPutts(r, 3, null, green); // fixed later, from anywhere
    expect(R.holeScore(r.holes[1])).toBe(4);
    expect(r.holes[1].shots[0].end).toEqual(green);
    r = R.setPutts(r, 0, null, green);
    expect(R.holeScore(r.holes[1])).toBe(1);
    expect(r.holes[1].log).toEqual(['shot', 'holed']);
  });
});
