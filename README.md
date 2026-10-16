# Tee Times

A private, mobile-first app for our golf group: live NYC public-course tee
times, propose one to the group, see who's in, and get alerts when new times
open. Shot tracking (GPS yardages, rounds, progress) is built in but hidden at
`#golf` for now. React + Vite + shadcn/ui, one Cloudflare Worker (static assets
+ a Hono API), D1 (SQLite). See [PLAN.md](PLAN.md) for the why.

## Develop

```sh
pnpm install
pnpm db:migrate:local   # create the local D1 tables (once)
pnpm dev                # app + API on http://localhost:5173 (local D1)
pnpm test               # vitest
pnpm typecheck
```

`.dev.vars` (gitignored) sets `DEV_EMAIL` (who you are locally, localhost only)
and local VAPID keys for push. Generate keys with `pnpm exec pushforge vapid`.

## Deploy (Cloudflare)

```sh
pnpm wrangler login
pnpm wrangler d1 create golf      # paste the printed database_id into wrangler.jsonc
pnpm db:migrate                   # create tables in the remote D1
pnpm exec pushforge vapid         # then:
pnpm wrangler secret put VAPID_PUBLIC_KEY
pnpm wrangler secret put VAPID_PRIVATE_JWK   # the JWK JSON on one line
pnpm wrangler secret put VAPID_CONTACT       # mailto:you@example.com
pnpm deploy
```

Then **Cloudflare Access** (Zero Trust → Access → Applications → Add →
Self-hosted): the Worker's hostname, with a policy allowing the group's emails.
Turn off the `*.workers.dev` URL (Worker → Settings → Domains). Copy the
application's **AUD tag** and your team domain (`<team>.cloudflareaccess.com`)
into `POLICY_AUD` and `TEAM_DOMAIN` in `wrangler.jsonc`, and deploy again. The
Worker checks the Access token on every API call; without those two values it
rejects everything.

Adding a golfer = adding their email to the Access policy. They open the site,
"Add to Home Screen" (needed for notifications on iPhone), and fill in Profile.

Alert checks run from the hourly cron at 7am, 12pm and 7pm New York time.

## Shot tracking (hidden, `#golf`)


- **Courses** → tap a course → pick tees → the round starts.
- **Play**: the big number is yards to the pin; front/back are to the edges of the
  green along your line. Drag the flag to today's pin. Tap the map to measure to a
  target (tap ○ to clear). "Plays" adjusts for elevation (~1 yd per 3 ft).
- **Mark shot** where your ball is, with the club you're about to hit (the
  suggested club is preselected). A shot's distance is set when you mark the next
  one, or putt. On the green, Mark shot becomes Putt. Tap a logged shot to flag a
  mishit (left out of club stats). **Hole done** moves on and syncs.
- **Progress**: handicap estimate, scoring trend, putts, greens in regulation, and
  per-club distance over time.
- **Bag**: stock yardages vs. tracked (median of your last 10 shots). Suggestions
  switch to tracked once a club has 3+ shots.

Data is saved on the phone on every tap and synced to D1 when you have signal.

## Courses (plug and play)

A course is one JSON file in `courses/`. Add a file, rebuild, and it shows up.
`pnpm test` validates every file against the schema in
[`src/schemas/course.ts`](src/schemas/course.ts), so a broken file fails the
tests instead of failing on the course.

Points are `[lng, lat]` (GeoJSON order). Only `number`, `par` and
`green.center` are required per hole; everything else is optional and the app
hides what's missing:

```jsonc
{
  "id": "clearview-park",               // must match the file name
  "name": "Clearview Park Golf Course",
  "locality": "Bayside, Queens, NY",
  "tees": [{ "id": "white", "name": "White", "color": "#f5f5f5", "rating": 69.0, "slope": 116 }],
  "holes": [{
    "number": 1, "par": 4, "hcp": 9,
    "yards": { "white": 354 },
    "tees": { "white": { "pos": [-73.7889, 40.7862], "elevFt": 21.8 } },
    "green": {
      "center": [-73.7884, 40.7834],
      "polygon": [[-73.7886, 40.7835], "…"],
      "elevFt": { "center": 42.8, "front": 41.7, "back": 44.1, "left": 42.4, "right": 43.6 }
    },
    "path": [[-73.7889, 40.7862], "…"],   // tee → green centerline
    "features": [{ "type": "bunker", "polygon": ["…"] }]
  }]
}
```

### Generating one from OpenStreetMap

1. Find the course on [openstreetmap.org](https://www.openstreetmap.org) and note
   its `leisure=golf_course` way/relation id. It needs `golf=hole` lines (tee → green,
   `ref` = hole number) and `golf=green` areas.
2. Copy `tools/sources/clearview-park.json`; set `id`, `name`, `osm.course`, tees and
   the scorecard (par, hcp, yards per tee).
3. `pnpm course:build tools/sources/<id>.json` (add `--no-elevation` outside the US).

The build prints card vs. mapped yardage per tee so bad OSM data is easy to spot.
Per-hole overrides in the source file: `"teePos": { "black": [lng, lat] }`,
`"greenCenter": [lng, lat]`; and `"osm": { "holes": ["way/…"] }` to pick holes when
two courses overlap.

**Clearview:** OSM is missing the back tee boxes on holes 3, 6, 9, 11 and 15, so
"from the tee" yardage there (before you're on the hole) is from a forward tee.
Live GPS yardages are unaffected; add `teePos` overrides when you have them.

## Layout

```
src/
  features/     tee times, games, alerts, profile (the main app)
  components/ui shadcn components
  golf/         hidden shot-tracking shell (#golf)
  schemas/      Zod: tee times, group (members, games, alerts), course file, round, bag
  lib/          geo, clubs, round actions, stats, store (IndexedDB + sync), elevation
  play/         on-course screen, map, GPS hook
  views/        courses, rounds, progress (uPlot), bag
worker/         Hono API on D1: tee-times, games, alerts (+ cron), push, me/members, rounds, bag
migrations/     D1 schema
courses/        course files
tools/          course builder
test/           vitest
```

## Limits

- Phone GPS is typically ±3–8 yd in the open; the map pill shows current accuracy.
- iOS needs the app open on screen to track (no background GPS); it keeps the
  screen awake during a round.
- Elevation (plays-like, green tilt) uses USGS data: US only.
- Handicap is an estimate (double-bogey cap, no course handicap strokes).
- Imagery © Esri; course data © OpenStreetMap contributors (ODbL).
