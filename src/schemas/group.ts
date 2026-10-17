import { z } from 'zod';
import { Criteria } from './teetimes';

export const Member = z.object({
  email: z.string(),
  name: z.string().max(40),
  homeCourse: z.string().nullable(), // NYC course code
  showHandicap: z.boolean(),
  notifyGames: z.boolean(),
  handicap: z.number().nullable(), // estimate, set by the member's own app
  // Display preferences; null = never chosen.
  theme: z.enum(['system', 'light', 'dark']).nullable(),
  temperatureUnit: z.enum(['fahrenheit', 'celsius']).nullable(),
});
export type Member = z.infer<typeof Member>;
export const MemberUpdate = Member.omit({ email: true }).partial();
export type MemberUpdate = z.infer<typeof MemberUpdate>;

export const RsvpStatus = z.enum(['in', 'out']);
export const GameStatus = z.enum(['open', 'booked', 'cancelled']); // booked = every tee time booked

/** One tee time in a game. A game can have several (eight players = two foursomes). */
export const GameTime = z.object({
  teetime: z.string(), // UTC ISO
  time: z.string(), // NY HH:MM
  spots: z.number().int().min(1).max(4), // open spots when it was added
  bookedBy: z.string().nullable(),
});
export type GameTime = z.infer<typeof GameTime>;

/** A player's round in this game, as the rest of the game sees it: score only, never shots. */
export const GameScore = z.object({
  email: z.string(),
  name: z.string(),
  thru: z.number().int(), // holes played
  toPar: z.number().int(),
  strokes: z.number().int(),
  done: z.boolean(),
});
export type GameScore = z.infer<typeof GameScore>;

export const Game = z.object({
  id: z.string(),
  code: z.string(),
  facilityId: z.number().int(),
  date: z.string(),
  holes: z.union([z.literal(9), z.literal(18)]),
  times: z.array(GameTime).min(1), // earliest first
  note: z.string().max(200).nullable(),
  createdBy: z.string(),
  status: GameStatus,
  players: z.array(z.object({ email: z.string(), name: z.string(), status: RsvpStatus, checkedIn: z.boolean() })),
  scores: z.array(GameScore),
  updatedAt: z.string(),
});
export type Game = z.infer<typeof Game>;

export const NewTime = GameTime.omit({ bookedBy: true });
export const NewGame = Game.pick({ code: true, facilityId: true, date: true, holes: true })
  .extend(NewTime.shape)
  .extend({ note: z.string().max(200).optional() });
export type NewGame = z.infer<typeof NewGame>;

/** Cancel (or undo a cancel), or change the note. Booking is per tee time: see BookTime. */
export const GameUpdate = z.object({ status: z.enum(['open', 'cancelled']).optional(), note: z.string().max(200).nullable().optional() });
export const BookTime = z.object({ teetime: z.string(), booked: z.boolean() });

export const Alert = z.object({
  id: z.string(),
  criteria: Criteria,
  seen: z.array(z.string()), // timeKey()s already shown
  /** Repeats every week on these days (0 = Sunday) within the booking window; empty = criteria.dates only. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  /** How often it's checked, in hours. */
  every: z.union([z.literal(1), z.literal(4), z.literal(12)]),
  /** timeKey()s a check notified about that the member hasn't opened yet. */
  unread: z.array(z.string()),
  paused: z.boolean(),
  createdAt: z.string(),
  checkedAt: z.string().nullable(),
  attemptedAt: z.string().nullable().optional(),
  checkFailed: z.boolean().optional(),
  nextCheckAt: z.string().nullable().optional(),
});
export type Alert = z.infer<typeof Alert>;
export const NewAlert = Alert.pick({ criteria: true, seen: true })
  .extend({ weekdays: Alert.shape.weekdays.default([]), every: Alert.shape.every.default(4) });
export const AlertUpdate = Alert.pick({ criteria: true, seen: true, paused: true, weekdays: true, every: true }).partial()
  .extend({ read: z.literal(true).optional() }); // read: clears unread

export const PushSub = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSub = z.infer<typeof PushSub>;
