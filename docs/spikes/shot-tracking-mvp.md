# Shot tracking and course visuals: MVP spike

Date: 2026-10-16. Status: feasibility investigated; isolated local prototype, not integrated or deployed.

## Decision

Proceed with one shot-first screen and exactly two camera presets: **Course** and **Green**. Keep the existing MapLibre renderer. The minimum useful experience is a yardage, a club with a stock range, and a dominant **Mark shot** button. Pinch, rotate, and tilt are feasible without a Google Earth integration.

Proceed with an **estimated** green/pin view and coarse high/low elevation samples. Do not present the existing five samples as a detailed contour map, a surveyed green, or a putting recommendation. Actual tracking accuracy remains unproven until outdoor phone testing.

## Run the spike

With the normal `pnpm dev` server running, open `/spikes/shot-tracking/` on the development origin. Current preview: `http://localhost:5174/spikes/shot-tracking/`.

```sh
pnpm exec tsx spikes/shot-tracking/verify.ts
pnpm exec tsc -p spikes/shot-tracking/tsconfig.json
```

The prototype uses public Clearview hole 1 geometry, the existing imagery service, AWS terrain tiles, simulated positions, and example club ranges. It does not request location, call the account API, write storage, or change the app's bag/rounds. Marks last only until reload. Course/Green changes only the camera. Explicit position buttons under the spike controls simulate an approach or a chip. The controls can also weaken or pause simulated GPS; pausing causes the fix to expire on the real clock.

To exercise map startup failure, open `/spikes/shot-tracking/?noMap=1`. The same failure handler covers a thrown map constructor/load error; numeric tracking initializes independently.

## Evidence from the current app

| Finding | Consequence | Location |
| --- | --- | --- |
| MapLibre already renders Esri satellite imagery; OSM supplies course geometry. | OSM is not the satellite image or a terrain elevation model. Keep these three layers distinct. | `src/play/HoleMap.tsx`, `tools/build-course.ts` |
| `maxPitch=0`, `touchPitch=false`, `dragRotate=false`, and rotation is explicitly disabled. | Current flat behavior is a configuration choice, not a library limitation. | `src/play/HoleMap.tsx` |
| GPS acquisition time is replaced with `Date.now()`. There is no expiry timer; errors do not clear the previous fix. `bestFix` falls back to the latest sample even if every candidate is expired. | A stale position can look live and still mark a shot or recommend a club. Reproduced by the verification script. | `src/play/useGeolocation.ts` |
| A 650-yard proximity check decides whether to use GPS or a tee fallback, independently of freshness/accuracy. | Off-hole/weak/stale positions can produce a convincing distance. Tee fallback must be clearly a planning origin and never record a shot. | `src/play/Play.tsx` |
| `Club.stock` is one number; suggestions switch to tracked medians after three shots. | Personal stock ranges are absent; a handful of noisy measurements can replace the user's settings. | `src/schemas/round.ts`, `src/lib/clubs.ts` |
| All non-putter, non-mishit completed shots enter one club pool; shot intent is not recorded. | Chips/partial swings can depress full-swing stock. Existing recommender suggests a full LW for a 20-yard target. Reproduced. | `src/lib/clubs.ts` |
| Only the start accuracy is saved. Hole completion may use the estimated pin as an endpoint; it can enter tracked club data. | Measurement confidence and endpoint provenance are lost. Reproduced. | `src/lib/round.ts`, `src/schemas/round.ts` |
| One installed course, 18 greens, five elevations per green; nine holes use identical coordinates for all three tees. | The course needs tee-position validation. Shared coordinates are a warning to verify, not proof each tee is wrong. Five heights are not a contour surface. | `courses/clearview-park.json` |

The on-screen play card currently also contains a scrolling whole-bag selector, elevation adjustment, tilt text, instructions, shot-history chips, score, hole controls, tools, and sync state. Move secondary controls out of the primary shot area; do not remove storage/sync reliability.

## The minimum product

### Course view

- Satellite imagery with OSM green/hazard geometry. Start in a restrained oblique camera, about 35–45°; permit two-finger tilt up to 60°, twist rotation, and pinch zoom. Retain a single recenter action.
- Always draw a readable yardage on the ball-to-pin line. Tapping a target temporarily shows ball → target and target → estimated pin distances. Camera movement must not alter the measured positions or distances.
- Bottom area: large distance and its destination, tappable recommended club plus range, one large **Mark shot · club** action, and quiet Undo/Putt actions. No permanent whole-bag strip or shot-history list.
- Tapping the club opens one small sheet with Full swing / Chip and club ranges. Manual override stays selected until marking or changing hole.

### Green view

- Same map instance and same shot workflow. Fit the green, ball, and pin; default to near top-down for measurement clarity. Allow the same gestures and an easy reset.
- Start the flag at mapped center, visibly labelled **estimated pin**. A manually moved flag remains a manual estimate, never a known daily hole location. There is no daily-pin feed in this project.
- Front/back distances remain tied to the ball-to-pin direction. Elevation labels stay at their geographic sample positions when rotating; don't reinterpret screen left/right as terrain direction.
- Show approximate relative high/low information only when available. Current sample labels are relative to the stored center elevation. Missing elevation means no relief overlay, not “flat.”
- Near the green, offer a saved chip range rather than deriving an arbitrary fraction of a full swing. Do not automatically switch to Putter based solely on a noisy green-boundary test; Putt remains a manual count.
- Proposed auto-camera thresholds: enter Green at ≤60 yd with a usable fix, exit at ≥90 yd. Respect manual view choice until the next hole; don't recenter while the user is manipulating the map. These thresholds need field testing.

## Stock ranges and recommendations

Candidate shape, not a production schema change:

```ts
type Club = {
  id: string;
  name: string;
  enabled: boolean;
  full: { low: number; high: number } | null;
  chip: { low: number; high: number } | null;
};
```

Use one normal full-swing range per club and one optional stock chip range for the few clubs the player chips with. Do not add a wedge clock, swing percentages, or multiple shot recipes. Low/high should be the player's normal window, not extreme best/worst shots. Never infer the user's personal range by adding an arbitrary spread to a scalar value.

For this minimal prototype, both ranges are **total playing distance (carry + roll)**, consistent with the existing bag's definition and what start/end GPS can measure. Label that explicitly. If the intended stock numbers are carry-only, name them accordingly and use user-entered carry ranges; measured GPS totals must never automatically replace them. Carry cannot be extracted from these two ground positions.

Recommendation rule in `spikes/shot-tracking/model.ts`:

1. Use the distance to the selected target, otherwise the estimated pin. Do not move the pin number when a club is overridden.
2. Filter to enabled clubs with a valid range for the selected shot intent.
3. Prefer a range containing the estimated distance; rank by midpoint proximity, then lower upper bound for ties. Show plausible neighbors when the GPS uncertainty overlaps their ranges. A midpoint ranks choices; it is not the displayed stock yardage.
4. If no range contains the target, say choose a club / between clubs instead of implying a precise fit. Do not suggest the longest club for an unreachable 400-yard target or a full LW for a 20-yard chip.
5. Weak or expired GPS pauses the automatic recommendation. Keep manual club choice and logging an unmeasured/low-quality shot available so the player can continue.
6. Keep user stock authoritative for MVP. Measured distances are observations; automatic learning is not required. Any later summaries must separate full swings, chips, mishits, uncertain endpoints, and low-quality GPS.

## Accuracy rules before integration

Browser geolocation reports acquisition time and a horizontal accuracy radius. Its nominal accuracy is not a promise that every shot distance is within that radius. Use the device's `position.timestamp`, preserve start and end accuracy/timestamps, and store the time the player actually marked the shot. Expire the live fix on a clock, on error, and on resume until a fresh fix arrives. Never treat smoothing or repeating samples as proof of improved sensor accuracy. [W3C Geolocation](https://www.w3.org/TR/geolocation/)

The spike proposes an 8-second maximum age, ≤8 m reported accuracy for full-swing recommendations, and ≤3 m for chip recommendations. These are testable product gates, not measured guarantees. The local simulator now demonstrates clock-based expiry after pausing its fix stream. Save `intent`, start/end sample metadata, endpoint origin (`measured`, `manual`, `estimated-pin`), and quality. An estimated pin endpoint can close scoring, but must not enter club-distance learning. Undo must reverse the matching endpoint metadata too.

Two endpoints each reporting a 3 m radius can create a conditional distance envelope of about ±6.6 yd if both true positions lie inside those radii. At 20 yd, that is a large fraction of the shot. Adding the radii is a conservative geometric envelope under that condition, **not** a calibrated 95% distance confidence interval. The prototype excludes short/noisy segments from statistics rather than presenting them as precise stock data.

OSM position error, an estimated pin, imagery alignment, and GPS error are separate uncertainties. The spike's GPS range-overlap logic does not claim to model all of them. Keep the destination labelled and don't silently use an estimated/tee coordinate as a measured ball position.

Keep normal yardage as horizontal ground distance. Terrain camera pitch/exaggeration must not change it. Leave automatic “plays like” club adjustment out of this MVP: the current 1 yd / 3 ft heuristic is not a validated ball-flight model.

## What the terrain data can actually show

- MapLibre supports two-finger zoom/rotation, two-finger pitch, and a `raster-dem` terrain source. The local prototype loaded AWS Terrarium tiles and rendered Course at 45° and Green at 0°. This gives draped satellite terrain, not photorealistic trees/buildings or a Google Earth reconstruction. [Touch pitch](https://maplibre.org/maplibre-gl-js/docs/API/classes/TwoFingersTouchPitchHandler/), [zoom/rotation](https://maplibre.org/maplibre-gl-js/docs/API/classes/TwoFingersTouchZoomRotateHandler/), [3D terrain](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/), [AWS dataset](https://registry.opendata.aws/terrain-tiles/)
- The existing imagery source stops at zoom 19. Zooming the map farther enlarges those images; it does not add photographic detail. Global terrain is for visual context, not green-reading measurements.
- A live USGS query at Clearview hole 1 center returned **42.815 ft, raster resolution 1 m, acquisition date 2014-03-01**. This is one point, not proof of current whole-green coverage or survey quality. The prototype's coarse AWS terrain reported about 12.3 m there; providers must not be silently interchanged for fine slope analysis.
- USGS says EPQS uses mixed-resolution DEMs, including 1 m where available; accuracy varies by source. Its published overall RMSE is 0.53 m, and point values are interpolated, not surveyed ground controls. That global statistic is not a local relative-slope error bound. The stored hole-1 left/right difference is only 1.2 ft; a confident break/contour claim needs local validation. [USGS EPQS accuracy](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map), [3DEP products](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services)
- The app's green schema has no elevation grid, acquisition date, source resolution, or vertical quality metadata. Interpolating a heatmap from five numbers would manufacture detail. For genuinely useful contour visuals, obtain a current georeferenced bare-earth raster for one green, preserve its metadata, and compare local relative heights with field measurements first. Until then, coarse sample labels with an estimate label are the honest MVP fallback.
- Mapterhorn's public TileJSON returned HTTP 403 in this environment. The public AWS tile for Clearview returned HTTP 200 and loaded in the browser. A production terrain choice still needs availability/performance checks and a flat-map fallback. Preserve imagery, terrain, and OSM attribution.

## Verification and remaining gates

Completed: 19 executable spike checks, including three reproductions of current app problems and regressions for disabled clubs, invalid/zero/tiny samples, first-putt endpoints, undo, weak endpoint quality, and duplicate taps. Strict spike and application typechecks pass. Browser checks cover camera-only transitions (150 yd / full 7i unchanged when switching to Green), actual terrain loading (12.3 m at the sampled green center, pitch 45° / 0°), full/chip suggestions, target yardages, duplicate-mark protection, first-putt measurement completion and Undo, weak/expired-GPS manual logging, and shot/putt/undo controls under forced map initialization failure. The expiry check waited on the real clock without injecting application state. Reviewed both views at 390 pixels and confirmed no horizontal page overflow and an on-screen Mark shot action at 320 pixels. This demonstrates interaction feasibility, not measured GPS accuracy.

Not established: actual phone GPS accuracy, physical two-finger behavior on iPhone/Android, battery/thermal performance, camera auto-switch tuning, GPU context-loss recovery after startup, accurate daily pins, or putting-grade contour data. A desktop prototype cannot establish these.

Before calling tracking accurate, take one installed course outdoors. Compare repeated start/end measurements against an independent laser/reflector reference at short-chip, pitch, iron, and long-shot distances; don't treat a dogleg scorecard yardage as a survey reference. Record the reported accuracy, acquisition/mark times, observed error, canopy conditions, and phone model. Include stale/denied GPS, resume, offline marks, duplicate taps, Undo, and manual pin placement. Report median and high-percentile errors by distance and quality band; retain a manual/unmeasured path wherever short-game accuracy is inadequate.

Implementation order: (1) location freshness and endpoint/intent metadata, (2) range-based bag inputs and separate stock-driven suggestions, (3) replace the play card with the minimal workflow and two camera presets, (4) field-test Clearview and validate green data. Reuse existing local persistence/sync and recovery behavior. No new analytics, social features, wind engine, ball-flight simulation, automatic shot detection, putting lines, or photorealistic 3D reconstruction are required.

## Implementation audit follow-up

The audit corrected the following issues in the isolated prototype; production files remain unchanged:

- **Camera controls changed shot data.** View changes now preserve ball, target, shot intent, and manual club choice. Explicit debug position controls own fixture movement. Green preview can frame the green while a distant ball stays off-screen; the HUD still shows its real fixture distance.
- **Shot measurements were temporary, and putts did not close a shot.** A pure action ledger now retains completed distances, closes the prior shot on the next shot or first putt, and derives endpoints again on Undo. Additional putts never remeasure the last shot.
- **Zero-length and very small uncertain segments could pass statistics gates.** Zero-length shots are excluded. The uncertainty envelope must be no wider than 20% of the measured distance; invalid coordinate/accuracy inputs return unavailable measurements instead of NaN. Quality decisions use the saved mark/acquisition times, not the later time the ledger is rendered.
- **Rapid double taps counted duplicate strokes.** Matching shot marks within 1.2 seconds are ignored with an Undo hint. Intentional repeated putt taps are still counted.
- **Map initialization could take the numeric workflow down with it.** Map initialization/load errors now show a fallback; club choice, marking, putting, and Undo initialize first and remain available. This does not establish recovery from a GPU context loss during play.
- **The simulator fabricated freshness whenever the screen rendered.** It now has an explicit simulated fix stream and a pause control. Expired fixes suppress live yardages and automatic suggestions without blocking manual shot logging.
- **A periodic render could repaint the map or disrupt accessible interaction.** Map sources/markers update only for geometry or display-quality changes. Club buttons retain their DOM identity/focus, and the live shot status changes only when its text changes.
- **Pin and ball markers were drag-only, with small targets.** Markers and target clearing have 44-pixel controls. Arrow keys move ball/pin one yard; estimated pins are constrained to the mapped green. Browser checks confirmed the 44-pixel marker bounds and that repeated arrow presses stop at the green boundary with a notice. Front/back numbers are replaced with an on-green label when the ball is inside the polygon.

Remaining MVP work is integration with the real bag, device GPS, and existing local save/sync—not more features. The spike still uses example ranges and in-memory marks. The field and green-data validation gates above remain mandatory before calling this accurate.
