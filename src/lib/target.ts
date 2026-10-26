import type { LngLat } from './geo';

// Screen pixels keep the target equally easy to catch at any map zoom. A wider
// release radius prevents flicker at the edge while still letting it drag away.
export function snapTargetToPin(position: LngLat, pin: LngLat,
  project: (point: LngLat) => { x: number; y: number }, wasSnapped = false) {
  const point = project(position), flag = project(pin);
  const snapped = Math.hypot(point.x - flag.x, point.y - flag.y) <= (wasSnapped ? 36 : 24);
  return { position: snapped ? pin : position, snapped };
}
