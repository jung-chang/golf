# Golf — plan

A private, mobile-first PWA for a group of 8+ golfers. On the surface it is
**NYC tee times**: search live public-course availability, propose a tee time to
the group, see who's in, and get alerts when new times open. The existing GPS
shot tracking stays, but it moves out of sight under each member's **Profile**.

Still kept small: one Worker, one D1 database, no auth code of our own.

## Where we are

Built (phases 1–5 below) for one user: courses as JSON, GPS yardages, shot
tracking, rounds, bag, progress charts, D1 sync. Not deployed yet, so the D1
schema can still be edited in place (no data migration).

## Users and auth

- Cloudflare Access protects the whole app. The Access policy holds the
  group's emails; adding a golfer = adding their email there. No sign-up flow.
- The Worker verifies the Access JWT (`Cf-Access-Jwt-Assertion`) with `jose`
  against the team's public keys and reads the email from it. It doesn't trust
  the plain email header, so a missed route or the `workers.dev` URL can't be
  used to pose as someone. Locally, `DEV_EMAIL` in `.dev.vars` stands in.
- First visit creates a member row; the member then fills in their profile.
- Everyone in the group is equal. No admin role.

## Stack

| Need | Choice | Change |
|---|---|---|
| App | Vite + React + TypeScript | — |
| UI | — | shadcn/ui (Radix + Tailwind v4), golf palette in `src/index.css`, lucide icons |
| PWA | vite-plugin-pwa | + a push handler in the service worker (`injectManifest`) |
| Routing | URL hash, tabs | tabs become Tee times · Games · Alerts · Profile |
| State | `useSyncExternalStore` store + IndexedDB (rounds, bag) | group data (games, alerts) is fetched, not stored offline |
| Hosting + API | One Cloudflare Worker (static assets + Hono) | + tee-time proxy, members, games, alerts routes |
| Database | D1 | + members, games, game_players, alerts, push_subs; rounds/bag keyed by member |
| Auth | Cloudflare Access | + `jose` to verify the Access JWT |
| Scheduled checks | — | Worker Cron Trigger hourly; each alert is checked every 1, 4 or 12 hours (its choice), game reminders at 7am |
| Notifications | — | Web Push (VAPID keys as Worker secrets); a small Workers-compatible web-push library |
| Tee-time data | — | TeeItUp/Kenna API, called by the Worker, cached 2–10 min with the Cache API (see below) |
| Map, charts | react-map-gl/maplibre, uPlot | — (profile only) |
| Validation | Zod | + Kenna response, API bodies for games/alerts/profile |
| Tests | Vitest | + tee-time filtering, alert "new vs seen" diff, auth helper |

Why these and not more: Cron Triggers and the Cache API are built into
Workers. The New York clock check in code avoids two UTC cron sets for daylight saving.
Web Push suits an installed PWA (on iPhone it requires "Add to Home Screen",
iOS 16.4+). Both search and alerts go through the Worker so filtering and
course rules live in one place, even though Kenna allows browser CORS.

## Tee times: fetching and caching

All in `worker/teetimes.ts`: course table, fetch, normalize, cache.

- **One request per booking system and date.** Four systems: GolfNYC (9
  courses), Pelham/Split Rock, Dyker, Marine Park. Always fetch every course in
  a system, so all searches and alerts share the same cache entries (at most
  4 × 14 = 56).
- **Normalize:** course from the facility ID inside each rate (not response
  order); open spots = `maxPlayers`; UTC → New York time; 9/18 from
  `rates[].holes`; one row per course and time. Never request 20170 or 4088,
  or Dyker beyond 10 days.
- **Cache (Cloudflare Cache API, not D1)**, 10 minutes at most: today and
  tomorrow 2 min, later dates 10 min.
- **Refresh** always skips the cache and fetches fresh. Results show
  "updated N min ago". Alert checks also fetch fresh.
- **Alert checks** collect the system/date pairs that active, unpaused alerts
  need, fetch each once, and check every alert against those results.
- **Failures** show "couldn't load" for that system's courses; nothing is
  guessed. The TeeItUp booking page is the final check before paying.
- **Tests** run against a saved real response, never the live API.

Not doing: storing tee times, background cache warming, KV.

## Data (D1)

D1 is Cloudflare's hosted SQLite; locally `pnpm dev` uses a SQLite file under
`.wrangler/state`. It holds only lasting data; tee times stay in the cache.

```sql
members      (email PK, name, home_course, show_handicap INT, notify_games INT, created_at)
push_subs    (endpoint PK, email, keys TEXT)              -- one per device
games        (id PK, code, facility_id, date, teetime, times TEXT, holes,
              created_by, status TEXT,                     -- open | booked | cancelled
              note, updated_at)                            -- times: [{teetime, time, spots, bookedBy}]
game_players (game_id, email, status TEXT, checked_in, PRIMARY KEY (game_id, email))   -- in | out
alerts       (id PK, email, criteria TEXT, seen TEXT, weekdays TEXT, every INT, unread TEXT,
              paused INT, created_at, checked_at)
rounds       (id PK, email, date, course_id, data, updated_at)             -- + email
settings     (email, key, data, PRIMARY KEY (email, key))                  -- bag, per member
```

`criteria` (dates, golfers, courses, 18 holes, time window), `seen` (set of
`facilityId|teetime` keys), `weekdays` (repeat days, [] = fixed dates) and
`unread` (keys notified but not yet opened) are JSON validated with Zod, like rounds.

## API

```
GET  /api/me                      PUT /api/me                 profile
GET  /api/members                                             names, home course, handicap if shown
GET  /api/tee-times?dates=&courses=                           normalized live times
GET  /api/games                   POST /api/games             upcoming games
PUT  /api/games/:id/rsvp          PUT /api/games/:id          in/out (no cap); cancel (or undo), note
POST /api/games/:id/times         PUT /api/games/:id/book     add a tee time; mark one booked
PUT  /api/games/:id/checkin                                   round day: I'm here (and in)
GET  /api/games/:id/ics                                       calendar event
GET  /api/badges                                              tab counts: games awaiting me, unread alert times
GET  /api/login                                               "Sign in again": Access signs in, then back to /
GET  /api/alerts                  POST/PUT/DELETE /api/alerts/:id
POST /api/push                    DELETE /api/push            subscribe a device
GET/PUT/DELETE /api/rounds…, GET/PUT /api/bag                  as now, scoped to the caller
```

## MVP features

1. **Tee times** (the spec in the appendix): date strip (up to 3 dates, 14-day
   window, Dyker 10), golfer counts, 14-tile course mosaic by borough, 18-hole
   box; results in one column per date, course toggles, date toggles, time
   window (time-of-day sheet), tap a row to book or propose it. A bell in the
   header opens Alerts.
2. **Games** — the collaborative part. On a result row, a second small button
   "Propose" posts that tee time to the group. Members with game notifications
   on get a push. Each member taps **In** or **Out**; the game shows who's in out
   of the open spots. The app can't book (TeeItUp has no booking API for us), so
   whoever books does it on TeeItUp and taps **Booked**. The Games tab lists
   upcoming games (mine first) and past results; each opens in a sheet.
3. **Alerts** (under Tee times): as in the spec, per member, with changes (see Phase 10). The
   cron compares live times with each alert's `seen` set and pushes only when
   something new matches.
4. **You** (profile): name, home course, opt in to game notifications, enable push on
   this device, choose whether the group sees my handicap estimate. **My golf**
   holds the existing Play / Rounds / Progress / Bag screens unchanged. A
   "Resume round" banner shows when a round is in progress.

Shot data is private to each member. The group sees name, home course and, if
the member opts in, their handicap estimate. A round started from a game also
shows its score (to par, holes played) to that game's players.

## Phases

1–5. Done: scaffold, course files, Play, history + bag + sync, progress.
6–9. Done (2026-10-14): first pass, built by subagents and checked in a phone-sized browser.
6. **Members.** Access JWT check, `members`, rounds/bag keyed by email, Profile
   tab, tracking moved under Profile, new tab bar.
7. **Tee times.** Kenna proxy with Zod + normalization and tests, search form,
   results screen.
8. **Games.** Propose from a result, RSVP, booked/cancelled, Games tab.
9. **Push + alerts.** Service-worker push, device subscription, alert setup
   popup, Alerts tab, cron.
10. **UX pass (2026-10-15).**
   - Each alert has a "Check" dropdown (Eastern time): every hour (6am–9pm),
     every 4 hours (7, 11, 3, 7) or every 12 hours (7am, 7pm). Default 4h.
     The cron runs hourly. (Was 7/12/19 for every alert.)
   - `seen` becomes "what matches now", so a time that's booked and then
     cancelled alerts again. Keys from a failed fetch are kept.
   - Optional weekly repeat on the alert's weekdays across the booking
     window. Its first check quietly takes stock of the extra weeks.
   - Fixed-date alerts pause themselves once their dates pass.
   - `unread` drives the "N new" label and the tab badge.
   - Notifications carry a tag so repeats replace each other.
   - Game pushes: "X is in" to the proposer, "Full" to everyone in, a 7am
     reminder on game day. All respect the game-notifications switch.
   - Games screen: shows who it's waiting on, "needs N more", share link
     (`#games/<id>`), Add to calendar (.ics), undo cancel.
   - First-run welcome sheet: name, home course, notifications, and iPhone
     install steps. Tee-time search starts from the home course.
   - Tab badges, placeholder rows while searching, undo delete for alerts.
   - Expired sign-in: the API helper catches Access's redirect and shows
     "Sign in again" (`/api/login`). Sign out goes to
     `/cdn-cgi/access/logout`.
   - Screens refresh when the app comes back to the foreground.

11. **Search → buy-in → round → results (2026-10-15).** One game covers the
    whole outing, with no player cap:
    - A game holds several tee times (eight players = two foursomes).
      Proposing a time at a course and date the group already has a game for
      offers "Add to the group's game".
    - When more players are in than spots, the card offers "Find another tee
      time for N". It opens the search for that course and day, around the
      game's times.
    - Each tee time is marked booked on its own ("I booked it", undo). The
      game counts as booked when all of them are.
    - The Games screen has Today, Coming up and Recent sections, and each card
      changes with its stage. Upcoming shows a countdown. Round day shows
      "Tee off in 2h", who's here, and "Start my round": it picks tees, checks
      you in, and opens shot tracking with the round linked to the game
      (`Round.gameId`). Courses without a course file get "I'm here" instead.
    - Leaderboard: score to par and holes played (thru) from each linked
      round. Shots stay private; you share only by starting from the game.
      Recent games show final results with a trophy.
    - A strip on every screen: "Round in progress · Resume", or
      "Today · CLR 7:12am · in 2h".
    - Shot tracking has "‹ Group" in its nav and a Leaderboard link in the
      hole bar.

12. **Simplify (2026-10-15).** Show only what helps the next step.
    - **Search:** golfers is one choice (Any, 1, 2, 3, 4), since the filter only
      ever used the smallest number. Removed the date ticks, the swipe hint and
      the borough legend; Find is pinned at the bottom.
    - **Results:** one header (‹, title, alert, refresh, "26 times · updated
      2 min ago"). Date and course toggles show only when more than one was
      searched. Rows are time + spots. Tapping a row opens a sheet: **Book on
      TeeItUp** or **Propose to the group**.
    - **Alerts:** a card is the summary plus a pause switch. Tap it for
      details, matching times (first 8) and Edit/Delete.
    - **Profile:** handicap rows only once there's an estimate.
    - **Booking loop.** Payment happens on TeeItUp, so the app can't book or
      confirm. Book opens the course's TeeItUp page for that day; TeeItUp has
      no link to a single time. The app remembers what you went to book (in
      localStorage, for 3 hours). When you come back it asks "Did you book
      6:57am at Clearview?" Yes marks that time booked, in its game or the
      group's game that day (or a new one), counts you in, and pushes the
      group. TeeItUp's email receipt stays the real proof.

13. **Course picker: Four Corners (2026-10-15).** It replaces the 4×4 mosaic.
    Four borough panels sit in map order (Bronx NW, Queens NE, Staten Island
    SW, Brooklyn SE) around a round Manhattan hub. Inside each panel, courses
    sit roughly where they are on the map. Dashed border = short course or
    pitch & putt; faded = no live times (Mosholu). The layout lives in
    `PICKER` in `src/lib/nyc.ts`, and a test checks every course appears once
    in its own borough. Chosen from four options (Four Corners, Pin Map,
    Compass, Transit Lines).

14. **Audit (2026-10-15).**
    - Server: an added tee time must fall on the game's date, and only the
      person who booked a time can undo it.
    - Results show a group icon on times already in a game.
    - The "Today" strip is hidden on the Games screen, which already leads
      with today's game.

15. **UX pass (2026-10-16).** Three tabs instead of four, and bottom sheets
    (shadcn Drawer, vaul) instead of centred dialogs.
    - **Tabs: Tee times · Games · You.** Search is still the landing screen.
    - **Alerts** are saved searches, so they live under Tee times: a bell in
      its header (with the unread count) opens the Alerts screen; each alert
      opens in a sheet with its live matches. The Tee times tab carries the
      alert badge.
    - **Games:** Upcoming / Past switch. Compact rows (date tile, times,
      faces, "In?" when you haven't answered); tapping one opens the whole
      game in a sheet with I'm in / Can't make it pinned at the bottom.
      Past = the last year (`GET /games?past=1`).
    - **You:** profile card (edit in a sheet), handicap and rounds, My golf
      (Rounds, Progress, Bag: the shot-tracking screens), notifications, the
      group, sign out.
    - **Results:** time of day is a chip that opens a sheet with presets
      (Early, Morning, Afternoon, Twilight) and the slider; course chips sit
      beside it, so the list gets the screen.
    - Sheets with a URL (`#games/<id>`, `#alerts/<id>`) close with the
      phone's back button.

16. **Tangerine and My golf (2026-10-16).**
    - Theme: tangerine (`--orange`, `-soft`, `-strong`) marks what needs you
      (counts, "In?", new matches, the round in progress, the suggested club,
      trend lines). Green is for acting; flag red only for destructive
      actions. The cream is a touch warmer to sit between them.
    - Shot tracking rebuilt in the app's own components (the old 5-tab area
      and its CSS are gone). **My golf** sits in the You tab: stats, then
      Rounds / Trends / Bag, and Start a round. A round's scorecard is its own
      page. **Play** is a full-screen map with a floating hole bar and a
      bottom card (yardage, club, Mark shot, score, Next hole); finishing
      asks in a sheet.

17. **Hardening (2026-10-16).**
    - The API answers only this app's own pages: cross-site fetches are
      refused (`Sec-Fetch-Site`), and every change must carry our own
      `Origin`. Opening an API link (the Access sign-in round trip, the .ics)
      still works. Security headers on the API (`secureHeaders`) and the
      pages (`public/_headers`).
    - Shot tracking's on-device stores are per member
      (`golf-rounds:<email>`), so a friend signing in on your phone never
      sees or syncs your rounds. The email is remembered for offline use.

## Open questions

- **Mosholu** uses its own booking system. Its source still has to be found
  and checked; until then its tile shows "book on site" and links out, with no
  made-up times.
- **Emblem art.** The two PNGs the spec names (`~/workspace/imagine_media/…`)
  aren't on this machine. The two center cells stay empty until they're added
  to `public/`.
- **Spec typo.** The mosaic row says `SPR`; the course table says `SPL` for
  Split Rock. Using `SPL`.
- **Groups of 8.** Done in Phase 11: one game, several tee times. Players
  aren't assigned to a tee time; anyone in can start their round.

## Not doing (until needed)

Booking inside the app, payments, chat, multiple groups, admin roles, email or
SMS notifications, offline group data, in-app course upload, offline map tiles,
auto shot detection, e2e browser tests.

## Golf tracking (You → My golf)

- One JSON file per course in `courses/`, checked by a test. Points are
  `[lng, lat]`. `tools/build-course.ts` builds one from OpenStreetMap, a
  scorecard and USGS elevation.
- A round is one JSON document, saved to IndexedDB on every tap and synced to
  D1 when a hole or round is finished, when the app opens, and when the phone
  comes back online.
- Zod checks course files, API bodies and backup imports. All types come from
  `z.infer`.

---

## Appendix: tee times spec

Source: `nyc-tee-times-prompt.md`. This is kept as written; how we adapted it
is in the notes at the end.

### Courses and data sources

Pull live availability from the TeeItUp/Kenna booking API (no login needed):

- Endpoint: `GET https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=YYYY-MM-DD&facilityIds={comma-separated IDs}`
- Header: `x-be-alias` set per tenant (see below)
- Booking window: up to 14 days in advance. Don't allow dates beyond that,
  except Dyker Beach, which books a maximum of 10 days out (never query or offer
  Dyker beyond 10 days).
- Each tee time in the response has: `teetime` (UTC ISO; display in
  America/New_York time), `maxPlayers` (number of OPEN spots), `rates[].holes`
  (18 or 9), prices in cents.

GolfNYC tenant (`x-be-alias: golf-nyc`):

| ID | Code | Course |
|---|---|---|
| 5044 | DGL | Douglaston Golf Course |
| 5043 | VCT | Van Cortlandt Golf Course |
| 5046 | KIS | Kissena Golf Course |
| 4757 | SLV | Silver Lake Golf Course |
| 5045 | FOR | Forest Park Golf Course |
| 16016 | FLU | Flushing Meadows Pitch and Putt |
| 4051 | SSO | South Shore Golf Course |
| 4049 | LTO | La Tourette Golf Course |
| 4047 | CLR | Clearview Park Golf Course |

Pelham Bay / Split Rock tenant (`x-be-alias: pelham-bay-split-rock`):

| ID | Code | Course |
|---|---|---|
| 4111 | PEL | Pelham Bay Golf Course |
| 19264 | SPL | Split Rock Golf Course |

Dyker Beach tenant (`x-be-alias: dyker-beach-golf-course`):

| ID | Code | Course |
|---|---|---|
| 4048 | DYK | Dyker Beach Golf Course |

Marine Park tenant (`x-be-alias: marine-park-golf-course`):

| ID | Code | Course |
|---|---|---|
| 4857 | MPK | Marine Park Golf Course |

Also include Mosholu Golf Course (code MOS). It uses its own live booking
source, so pull its availability from its booking page.

Never include facility 20170 (a simulator) or 4088 (a backend master record,
not bookable).

Labels: badge Flushing Meadows (FLU) as "pitch & putt" everywhere it appears.
Badge Douglaston (DGL), Silver Lake (SLV), and Kissena (KIS, verified par 64)
as "short course". Only badge courses with a confirmed sub-70 par; never infer
pars.

### First screen (search form)

- Date picker: a horizontal scrolling strip of days I can scroll forward
  through. Tapping a day selects it (max 3 dates). Selected days are
  highlighted. Show three tick indicators that fill up as I select dates, one
  tick per selected date. Guidance text under the strip: "Select up to three
  and swipe for later dates."
- Number of golfers: multi-select across 1, 2, 3, 4 (I can pick more than one
  option). Starts with nothing selected. Searching with no golfers selected
  shows all tee times with no golfer-count filter.
- Course picker: a full-width mosaic of 14 equal rounded tiles in a 4×4 grid
  with no gaps, grouped by borough with green rounded outlines and a centered
  borough legend at the bottom.
  - The two center cells are an open space (no tiles, no text) holding a
    softened-white club-throw silhouette emblem on the same green as the page
    background.
  - The left cell holds a torso-and-above golfer in a two-handed club-throw
    follow-through. The right cell holds a separate, smaller flying club. The
    two don't overlap.
  - Source art: `~/workspace/imagine_media/tee-times-emblem-torso-only-softwhite.png`
    for the torso, `~/workspace/imagine_media/tee-times-emblem-club-softwhite.png`
    for the club.
  - Multi-select, with select-all/clear and a selected count. A selected tile
    fills fully to its tile edges but never crosses its borough outline.
  - Tile layout: row 1 VCT SPR FLU CLR; row 2 MOS PEL KIS DGL; row 3 SLV
    (empty) (empty) FOR; row 4 SSO LTO DYK MPK.
- Checkbox: 18 holes, checked by default. (Saved searches and alert edits keep
  their stored hole preference.)

### Results screen

- Show exactly one row per course/time (never duplicate). Each row is short
  and one line: tee time, course abbreviation, numeric open spots, booking
  arrow. Never use the word "open".
- Only include tee times with at least as many open spots as the smallest
  golfer count I selected (e.g. selecting 2 golfers shows times with 2, 3, or 4
  open).
- Sort earliest to latest.
- Condensed header with:
  - a time-range banner showing the active time window;
  - an "Earliest Openings" section with the alerts bell beside it;
  - an action row with left-arrow Edit (back to the search form), Set alert,
    and Refresh.
- If I selected more than one date, show each date as its own column. Each
  column scrolls independently. The column layout rebalances for one, two, or
  three dates.
- Bottom bar: toggle buttons for each course I selected in the search (only
  those courses, not the full list). Toggling filters the already-fetched
  results live with no new search. To include courses beyond the initial
  selection, I go back and run a new search.
- Tapping a date greys it out and hides its column; tapping it again restores
  it. No new search. Date selector buttons show a small "x showing" count of
  matching times per date; no duplicate static date headings.
- Time-of-day slider: one slider with two handles (start and end of the window
  I want), 15-minute increments, time labels at each handle. The handles can
  meet but never cross. Filters results to tee times inside the window.
- Tapping a tee time opens the closest course/date booking page (e.g.
  `https://pelham-bay-split-rock.book.teeitup.com/?course=4111&date=YYYY-MM-DD`),
  because the booking platform has no stable per-row deep links.

### Alerts

- From the results page I can set an alert based on my current search. A setup
  popup asks me to reconfirm. It is read-only and inherits exactly what's on
  the results page:
  - greyed-out dates start unselected;
  - toggled-off courses stay off;
  - golfers and the 18-hole preference carry over;
  - the time slider position becomes the alert's time window.
- The setup popup also lists the matching tee times labeled "New" vs "Already
  seen". Everything visible at setup counts as already seen: the alert only
  fires when never-before-seen availability matching my criteria appears.
- The popup offers only two actions: Set alert, or Back to results (to adjust
  filters there and come back).
- Alert checks run at 7am, 12pm, and 7pm Eastern. When new matching
  availability appears, I get a notification listing the new times plus the
  old already-seen ones (in case I change my mind), with booking links.
- Alerts tab: view all active alerts, edit an alert, pause/resume an alert,
  and delete alerts.
  - Editing reopens the same setup popup, pre-filled with that alert's
    criteria and editable there.
  - Paused alerts stop checks and notifications but keep their criteria and
    history.

### Notes

- Do not invent or fake availability. Every tee time shown must come from the
  live API.

### How we adapt it

- **Live API checked (2026-10-14):** the Kenna endpoint answers without login
  and allows CORS. The response is a list per facility, each item
  `{dayInfo, teetimes[]}`. `maxPlayers` is the open spots, with `bookedPlayers`
  alongside.
- **Mosholu:** see Open questions. No times are shown for it until a live
  source is confirmed.
- **Result rows:** each row gets one small extra button, **Propose**, which
  creates a group game. Tapping the row itself still opens the booking page,
  as the spec says.
- **Alerts:** each alert belongs to the member who set it. Notifications are
  Web Push to that member's devices. The notification opens the app on that
  alert's matches, which carry the booking links. Instead of 7/12/19 for all,
  each alert picks every 1, 4 or 12 hours.
- **Theme:** the search form uses the app's green.
