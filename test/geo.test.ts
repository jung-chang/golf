import { describe, expect, it } from 'vitest';
import { centroid, distM, distYd, frontBack, offset, pointAhead, pointInPolygon, type LngLat } from '../src/lib/geo';
import { bestFix } from '../src/play/useGeolocation';

const me: LngLat = [-73.79, 40.78];

describe('geo', () => {
  it('measures 100 m as ~109.4 yd', () => {
    expect(distYd(me, offset(me, 0, 100))).toBeCloseTo(109.36, 1);
  });

  it('finds front and back of a green straight ahead', () => {
    const c = offset(me, 0, 150); // green center 150 m north, 20 m deep
    const corner = (ns: number, ew: number) => offset(offset(c, ns, 10), ew, 10);
    const green = [corner(0, 90), corner(0, 270), corner(180, 270), corner(180, 90)];
    const { front, back } = frontBack(me, c, green);
    expect(front).toBeCloseTo(140, 0);
    expect(back).toBeCloseTo(160, 0);
    expect(pointInPolygon(c, green)).toBe(true);
    expect(distYd(centroid(green), c)).toBeLessThan(0.1);
  });
});

describe('bestFix', () => {
  it('prefers the most accurate recent reading at the same spot', () => {
    const fixes = [{ pos: me, acc: 3, t: 1000 }, { pos: offset(me, 90, 2), acc: 8, t: 2000 }];
    expect(bestFix(fixes, 2500)?.acc).toBe(3);
  });

  it('ignores accurate readings from before you walked to your ball', () => {
    const ball = offset(me, 0, 200);
    const fixes = [{ pos: me, acc: 3, t: 1000 }, { pos: ball, acc: 5, t: 4000 }];
    expect(bestFix(fixes, 4500)?.pos).toEqual(ball);
  });
});

describe('pointAhead', () => {
  it('finds the spot on the centerline a given distance ahead of you', () => {
    const tee: LngLat = [-73.79, 40.78];
    const bend = offset(tee, 0, 200);
    const green = offset(bend, 90, 150);
    const p = pointAhead([tee, bend, green], tee, 230)!;
    expect(distM(tee, p)).toBeCloseTo(230, 0);
    expect(p[0]).toBeGreaterThan(bend[0]); // past the dogleg
    expect(pointAhead([tee, bend, green], tee, 1000)).toBeNull();
  });
});
