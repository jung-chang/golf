import { z } from 'zod';

const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One bookable tee time, normalized from TeeItUp. Times are New York local. */
export const TeeTime = z.object({
  code: z.string(), // course code, e.g. CLR
  facilityId: z.number().int(),
  date: Ymd, // NY date
  time: z.string().regex(/^\d{2}:\d{2}$/), // NY 24h time
  teetime: z.string(), // original UTC ISO
  spots: z.number().int().min(0), // open spots (Kenna maxPlayers)
  holes: z.array(z.number().int()), // e.g. [9, 18]
  priceCents: z.number().int().nullable(), // lowest green fee, if given
});
export type TeeTime = z.infer<typeof TeeTime>;

export const TeeTimesResponse = z.object({
  times: z.array(TeeTime),
  /** When each tenant/date was fetched from TeeItUp, keyed `tenant|date`. */
  fetched: z.record(z.string(), z.string()),
  /** Tenant/dates that failed; their courses show "couldn't load". */
  errors: z.array(z.object({ tenant: z.string(), date: Ymd })),
});
export type TeeTimesResponse = z.infer<typeof TeeTimesResponse>;

/** What a search (and an alert) filters on. */
export const Criteria = z.object({
  dates: z.array(Ymd).min(1).max(3),
  golfers: z.array(z.number().int().min(1).max(4)), // empty = no golfer filter
  codes: z.array(z.string()).min(1),
  holes18: z.boolean(),
  /** Explicit round length. Absent on older saved searches/alerts (false means either). */
  holes: z.union([z.literal(9), z.literal(18)]).optional(),
  /** Minutes after midnight NY, [start, end], 15-minute steps. */
  window: z.tuple([z.number().int().min(0).max(1440), z.number().int().min(0).max(1440)]),
});
export type Criteria = z.infer<typeof Criteria>;

/** Stable id for "seen" sets and de-duplication. */
export const timeKey = (t: Pick<TeeTime, 'facilityId' | 'teetime'>) => `${t.facilityId}|${t.teetime}`;
