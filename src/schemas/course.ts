// The course file format. One JSON file per course in /courses; anything that
// produces this shape (OSM builder, hand-drawn, another API) plugs straight in.
// Only holes with number, par and green center are required.
import { z } from 'zod';

export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const Polygon = z.array(LngLat).min(3);

export const Tee = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  rating: z.number().min(50).max(90).optional(),
  slope: z.number().int().min(55).max(155).optional(),
});

export const Hole = z.object({
  number: z.number().int().min(1),
  par: z.number().int().min(3).max(6),
  hcp: z.number().int().min(1).max(18).optional(),
  yards: z.record(z.string(), z.number().positive()).optional(), // by tee id
  tees: z.record(z.string(), z.object({ pos: LngLat, elevFt: z.number().optional() })).optional(),
  green: z.object({
    center: LngLat,
    polygon: Polygon.optional(),
    elevFt: z.object({
      center: z.number(),
      front: z.number().optional(),
      back: z.number().optional(),
      left: z.number().optional(),
      right: z.number().optional(),
    }).optional(),
  }),
  path: z.array(LngLat).min(2).optional(), // tee → green centerline
  features: z.array(z.object({ type: z.enum(['bunker', 'water', 'fairway']), polygon: Polygon })).optional(),
});

export const Course = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes'),
  name: z.string().min(1),
  locality: z.string().optional(),
  attribution: z.string().optional(),
  tees: z.array(Tee).min(1),
  holes: z.array(Hole).min(1),
}).superRefine((c, ctx) => {
  const teeIds = new Set(c.tees.map((t) => t.id));
  const seen = new Set<number>();
  c.holes.forEach((h, i) => {
    if (seen.has(h.number)) ctx.addIssue({ code: 'custom', path: ['holes', i, 'number'], message: `duplicate hole ${h.number}` });
    seen.add(h.number);
    for (const key of ['yards', 'tees'] as const) {
      for (const id of Object.keys(h[key] ?? {})) {
        if (!teeIds.has(id)) ctx.addIssue({ code: 'custom', path: ['holes', i, key, id], message: `unknown tee "${id}"` });
      }
    }
  });
});

export type Course = z.infer<typeof Course>;
export type Hole = z.infer<typeof Hole>;
export type Tee = z.infer<typeof Tee>;
