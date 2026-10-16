// Plug-and-play guarantee: every file in /courses must be a valid course.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../src/lib/geo';
import { Course } from '../src/schemas/course';

const dir = new URL('../courses/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe.each(files)('courses/%s', (file) => {
  const data = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));

  it('matches the course schema', () => {
    const r = Course.safeParse(data);
    expect(r.success, r.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')).toBe(true);
  });

  it('has its id as the file name and green centers on their greens', () => {
    const c = Course.parse(data);
    expect(`${c.id}.json`).toBe(file);
    for (const h of c.holes) if (h.green.polygon) expect(pointInPolygon(h.green.center, h.green.polygon), `hole ${h.number}`).toBe(true);
  });
});

describe('course schema rejects common mistakes', () => {
  const base = { id: 'x', name: 'X', tees: [{ id: 'w', name: 'White' }], holes: [{ number: 1, par: 4, green: { center: [-73.79, 40.78] } }] };
  it('accepts a minimal course', () => expect(Course.safeParse(base).success).toBe(true));
  it('rejects a missing green', () => expect(Course.safeParse({ ...base, holes: [{ number: 1, par: 4 }] }).success).toBe(false));
  it('rejects [lat, lng] for a western-hemisphere course', () =>
    expect(Course.safeParse({ ...base, holes: [{ number: 1, par: 4, green: { center: [40.78, -173.79] } }] }).success).toBe(false));
  it('rejects yards for an unknown tee', () =>
    expect(Course.safeParse({ ...base, holes: [{ ...base.holes[0], yards: { blue: 300 } }] }).success).toBe(false));
  it('rejects duplicate hole numbers', () =>
    expect(Course.safeParse({ ...base, holes: [base.holes[0], base.holes[0]] }).success).toBe(false));
});
