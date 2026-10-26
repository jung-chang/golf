import { expect, it } from 'vitest';
import { snapTargetToPin } from '../src/lib/target';
import type { LngLat } from '../src/lib/geo';

const pin: LngLat = [10, 20];
const project = ([x, y]: LngLat) => ({ x, y });

it('snaps to the exact current flag position inside the touch radius', () => {
  expect(snapTargetToPin([22, 36], pin, project)).toEqual({ position: pin, snapped: true });
  expect(snapTargetToPin([34, 20], pin, project).snapped).toBe(true);
});
it('leaves a target outside the snap radius where it was dragged', () => {
  const point: LngLat = [35, 20];
  expect(snapTargetToPin(point, pin, project)).toEqual({ position: point, snapped: false });
});
it('uses screen distance rather than a fixed ground distance at different zooms', () => {
  const point: LngLat = [11, 20];
  expect(snapTargetToPin(point, pin, ([x, y]) => ({ x: x * 20, y: y * 20 })).snapped).toBe(true);
  expect(snapTargetToPin(point, pin, ([x, y]) => ({ x: x * 50, y: y * 50 })).snapped).toBe(false);
});
it('holds through small edge movement and releases when deliberately pulled away', () => {
  expect(snapTargetToPin([40, 20], pin, project, true).snapped).toBe(true);
  expect(snapTargetToPin([47, 20], pin, project, true).snapped).toBe(false);
  expect(snapTargetToPin([40, 20], pin, project, false).snapped).toBe(false);
});
it('snaps to a repositioned flag instead of the original green center', () => {
  const moved: LngLat = [100, 100];
  expect(snapTargetToPin([115, 100], moved, project).position).toBe(moved);
  expect(snapTargetToPin(pin, moved, project).snapped).toBe(false);
});
