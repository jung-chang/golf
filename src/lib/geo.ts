// Geometry helpers. Points are GeoJSON order: [lng, lat].
// Shared by the app, the worker-free tools and tests, so no DOM here.

export type LngLat = [number, number];

const R = 6371008.8; // mean earth radius, meters
export const M_TO_YD = 1.0936133;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const distYd = (a: LngLat, b: LngLat) => distM(a, b) * M_TO_YD;

export function bearing(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = [rad(a[0]), rad(a[1])];
  const [lng2, lat2] = [rad(b[0]), rad(b[1])];
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Point `m` meters from `a` along compass bearing `brg`.
export function offset(a: LngLat, brg: number, m: number): LngLat {
  const d = m / R;
  const t = rad(brg);
  const lat1 = rad(a[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lng2 = rad(a[0]) + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lng2), deg(lat2)];
}

// Local flat projection (meters, x east / y north). Accurate at golf-hole scale.
export function projector(origin: LngLat) {
  const kx = (Math.PI / 180) * R * Math.cos(rad(origin[1]));
  const ky = (Math.PI / 180) * R;
  return {
    xy: (p: LngLat): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    ll: ([x, y]: [number, number]): LngLat => [origin[0] + x / kx, origin[1] + y / ky],
  };
}

export function centroid(poly: LngLat[]): LngLat {
  const P = projector(poly[0]);
  const pts = poly.map(P.xy);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = pts.length;
    return P.ll([pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]);
  }
  return P.ll([cx / (3 * a), cy / (3 * a)]);
}

export function pointInPolygon(p: LngLat, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Distance (m) from p to a polyline, and how far along the line (m) the closest point is.
export function nearestOnLine(p: LngLat, line: LngLat[]): { d: number; along: number } {
  const P = projector(p);
  const pts = line.map(P.xy);
  let best = { d: Infinity, along: 0 };
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const segLen = Math.sqrt(len2);
    if (d < best.d) best = { d, along: run + t * segLen };
    run += segLen;
  }
  return best;
}

export const lineLengthM = (line: LngLat[]) => line.slice(1).reduce((s, p, i) => s + distM(line[i], p), 0);

// Meters from `from` to where the ray toward `to` enters and leaves `poly`.
// Falls back to the polygon's extent along that direction if the ray misses.
export function frontBack(from: LngLat, to: LngLat, poly: LngLat[]): { front: number; back: number } {
  const P = projector(from);
  const [tx, ty] = P.xy(to);
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len, uy = ty / len;
  const pts = poly.map(P.xy);
  const hits: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax, ey = by - ay;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den; // distance along ray
    const s = (ax * uy - ay * ux) / den; // fraction along edge
    if (t >= 0 && s >= 0 && s <= 1) hits.push(t);
  }
  if (hits.length >= 2) return { front: Math.min(...hits), back: Math.max(...hits) };
  const proj = pts.map(([x, y]) => x * ux + y * uy);
  return { front: Math.max(0, Math.min(...proj)), back: Math.max(...proj) };
}

// [[west, south], [east, north]]
export function bounds(points: LngLat[]): [LngLat, LngLat] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lo, la] of points) {
    w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la);
  }
  return [[w, s], [e, n]];
}

export const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
