// Rounds and the bag: what's stored on the phone, synced to D1, and backed up.
import { z } from 'zod';
import { LngLat } from './course';

export const Shot = z.object({
  club: z.string(),
  pos: LngLat, // where it was hit from
  end: LngLat.nullable(), // where it finished; set by the next shot, first putt, or holing out
  acc: z.number().nonnegative(), // GPS accuracy, meters
  t: z.number(), // epoch ms
  mishit: z.boolean().default(false),
});

export const HoleState = z.object({
  shots: z.array(Shot),
  putts: z.number().int().nonnegative(),
  penalties: z.number().int().nonnegative(),
  adj: z.number().int(), // manual +/- for strokes not marked
  pin: LngLat.nullable(),
  log: z.array(z.enum(['shot', 'putt', 'pen', 'holed'])), // for undo
});

export const Round = z.object({
  id: z.string().min(1),
  courseId: z.string(),
  courseName: z.string(),
  gameId: z.string().optional(), // started from a group game: its score shows on that game's leaderboard
  teeId: z.string(),
  teeName: z.string(),
  rating: z.number().optional(),
  slope: z.number().optional(),
  date: z.iso.datetime(),
  pars: z.record(z.string(), z.number().int()), // by hole number
  holes: z.record(z.string(), HoleState),
  current: z.number().int(),
  done: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const Club = z.object({
  id: z.string(),
  name: z.string().min(1),
  stock: z.number().positive().nullable(), // typical full-swing total yards
  on: z.boolean(),
});

export const Bag = z.object({
  clubs: z.array(Club),
  useTracked: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export const Backup = z.object({
  rounds: z.array(Round),
  bag: Bag,
});

export type Shot = z.infer<typeof Shot>;
export type HoleState = z.infer<typeof HoleState>;
export type Round = z.infer<typeof Round>;
export type Club = z.infer<typeof Club>;
export type Bag = z.infer<typeof Bag>;
export type Backup = z.infer<typeof Backup>;
