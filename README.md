# Tee Times

A private, mobile-first app for a golf group: live NYC public-course tee
times, propose one to the group, see who's in, and get alerts when new times
open. Shot tracking (GPS yardages, rounds, progress) lives in You → My golf.
React + Vite + shadcn/ui, one Cloudflare Worker (static assets
+ a Hono API), D1 (SQLite). See [PLAN.md](PLAN.md) for the why.

## Develop

```sh
pnpm install
pnpm db:migrate:local   # create the local D1 tables (once)
pnpm dev                # app + API on http://localhost:5173 (local D1)
pnpm test               # vitest
pnpm typecheck
```

Copy `.dev.vars.example` to `.dev.vars` (gitignored): `DEV_EMAIL` is who you
are locally (localhost only), plus local VAPID keys for push
(`pnpm exec pushforge vapid`).

## Self-host it for your group (Cloudflare)

Each group runs its own copy on its own Cloudflare account and domain. This repo
holds no group-specific values: your domain, Access settings and keys live in
Cloudflare, never in git. Free plans cover a group (Workers, D1, Zero Trust up to
50 people).

1. **Domain.** Add it to Cloudflare (or buy it there) and wait until it's Active.
2. **Database.** `pnpm wrangler login`, then `pnpm wrangler d1 create golf`.
   (No id to paste: the config finds the database by name.)
3. **Sign-in (Zero Trust → Access → Applications).**
   - Self-hosted app for `<your-domain>`, session 1 month, policy **Allow** →
     **Emails** = your group.
   - In the app's **Settings → Cookies**: SameSite **Lax**, **HTTP Only** on,
     and **Binding Cookie** on (ties the sign-in to the device it was made on).
   - A second self-hosted app with action **Bypass** → **Everyone** for
     `<your-domain>/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png` and
     `/apple-touch-icon.png`. Browsers fetch these without the sign-in cookie,
     and installing the app needs them.
4. **Secrets** (`pnpm wrangler secret put <NAME>`):
   - `TEAM_DOMAIN`: `<team>.cloudflareaccess.com`
   - `POLICY_AUD`: the Access app's AUD tag
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK`, `VAPID_CONTACT`: from
     `pnpm exec pushforge vapid` (new keys, not your local ones); contact is
     `mailto:<you>`
5. **Deploy.** Either by hand:
   ```sh
   pnpm build && pnpm wrangler d1 migrations apply golf --remote && pnpm wrangler deploy --domain <your-domain>
   ```
   or on every push to `main` with Workers Builds (Worker → Settings → Builds →
   connect your fork). Build command `pnpm build`; deploy command
   `pnpm wrangler d1 migrations apply golf --remote && pnpm wrangler deploy --domain "$DOMAIN"`;
   add `DOMAIN` under the build's variables.

The Worker checks the Access token on every API call and rejects everything
until `TEAM_DOMAIN` and `POLICY_AUD` are set. It also only answers the app's own
pages (`worker/origin.ts`: browsers label each request with where it came from),
so another site can't act with a member's sign-in. `public/_headers` adds the
usual security headers to the pages. workers.dev and preview URLs are
off so nothing skips Access. Keep emails, keys and exports out of your fork
(see [AGENTS.md](AGENTS.md)).

Adding a golfer = adding their email to the Access policy. They open the site,
"Add to Home Screen" (needed for notifications on iPhone), and fill in Profile.

Alert checks run from the hourly cron at 7am, 12pm and 7pm New York time.

## Shot tracking (You → My golf)

- **Find a time:** choose up to three dates, minimum available spots, time of day,
  and courses. Pick course tiles in four borough panels around Manhattan, or
  open course search to find a course by name, code, or borough.
  The compact search panel starts collapsed, with the next Saturday and Sunday,
  four players, 18 holes, and the full day selected for a new search. Swipe the
  date row to browse. On results, time changes filter loaded availability;
  changes to dates, round length, or players require **Search with new parameters**.
  Courses stay fixed until you return to the search page. Existing saved choices
  are restored when valid; nine-hole searches require nine-hole availability.
  Results use one date at a time, with full course names, holes, availability and
  starting prices when supplied. Search and filter state survives reloading this
  tab or returning from TeeItUp; availability is refreshed when the app resumes.
- **Appearance:** You → Appearance offers Follow phone setting, Light, and Dark.
  Charts follow the theme and include expandable text data.
- **Booking:** proposing or RSVPing never reserves a tee time. Games show booking
  status separately; TeeItUp handles the reservation and payment.

- **My golf** (`#golf`): your numbers (handicap estimate, average score, putts,
  greens), then **Rounds** (tap one for its scorecard and every shot), **Trends**
  (scoring and per-club distance over time) and **Bag**. **Start a round** →
  pick tees. On round day, "Start my round" in a game does the same and puts your
  score on that game's leaderboard.
- **Play** is full screen: the big number is yards to the pin; front/back are to
  the edges of the green along your line. Drag the flag to today's pin. Tap the
  map to measure to a target (tap ○ to clear). "Plays" adjusts for elevation
  (~1 yd per 3 ft). ✕ leaves the map; the round keeps going (resume from the
  orange strip).
- **Mark shot** where your ball is, with the club you're about to hit (the
  suggested club is highlighted). A shot's distance is set when you mark the next
  one, or putt. On the green, Mark shot becomes Putt. Tap a logged shot to flag a
  mishit (left out of club stats). **Next hole** moves on and syncs.
- **Bag**: stock yardages vs. tracked (median of your last 10 shots). Suggestions
  switch to tracked once a club has 3+ shots.

Data is saved on the phone on every tap and synced to D1 when you have signal.
The golf screens show saving, saved locally, syncing, and retry states. If a
local save fails, keep the app open and retry. Each member has separate stores;
an offline visit can use the last verified member, while online identity errors
never fall back to another member. Requests include the expected member, which
the Worker compares with the authenticated identity. An account change locks
the old view and asks for a reload. Handicap publishing waits for a complete
successful sync. There is no migration from pre-launch local database names.

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
  components/   shared screen pieces (page.tsx) and shadcn components (ui/)
  golf/         My golf: rounds, trends (uPlot), bag, scorecard, start a round
  schemas/      Zod: tee times, group (members, games, alerts), course file, round, bag
  lib/          geo, clubs, round actions, stats, store (IndexedDB + sync), elevation
  play/         on-course screen (full-screen map), GPS hook
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
