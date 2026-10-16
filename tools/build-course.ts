// Build a course file from a source config:
//   pnpm course:build tools/sources/<course>.json [--no-elevation]
//
// Geometry comes from OpenStreetMap (golf=hole/green/tee/bunker/...), the
// scorecard (par, hcp, yards per tee) from the source config, and elevation
// from the USGS 3DEP point service (US only). Writes courses/<id>.json, checked
// against the same Zod schema the app uses.
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { bearing, centroid, distM, frontBack, lineLengthM, M_TO_YD, nearestOnLine, offset, pointInPolygon, type LngLat } from '../src/lib/geo';
import { Course, Hole, LngLat as LngLatSchema, Tee } from '../src/schemas/course';

const Source = z.object({
  id: z.string(),
  name: z.string(),
  locality: z.string().optional(),
  scorecard: z.string().optional(), // where the par/hcp/yards came from
  osm: z.object({ course: z.string().regex(/^(way|relation)\/\d+$/), holes: z.array(z.string()).optional() }),
  tees: z.array(Tee).min(1),
  holes: z.array(z.object({
    number: z.number().int(),
    par: z.number().int(),
    hcp: z.number().int().optional(),
    yards: z.record(z.string(), z.number()).optional(),
    teePos: z.record(z.string(), LngLatSchema).optional(), // override a tee when OSM is wrong
    greenCenter: LngLatSchema.optional(),
  })),
});

const UA = 'self-hosted golf PWA course builder';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

type OsmEl = { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number } };

async function overpass(query: string): Promise<OsmEl[]> {
  for (const url of OVERPASS) {
    try {
      // GET + a descriptive User-Agent: overpass-api.de rejects curl-style POSTs with 406.
      const res = await fetch(`${url}?data=${encodeURIComponent(query)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return ((await res.json()) as { elements: OsmEl[] }).elements;
      console.warn(`overpass ${url}: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`overpass ${url}: ${(e as Error).message}`);
    }
  }
  throw new Error('all Overpass servers failed');
}

async function elevationFt([lng, lat]: LngLat): Promise<number | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
      const v = Number(((await res.json()) as { value?: unknown }).value);
      if (Number.isFinite(v) && v > -1000) return Math.round(v * 10) / 10;
    } catch { /* retry */ }
  }
  return undefined;
}

const geom = (el: OsmEl): LngLat[] => (el.geometry ?? []).map((p) => [p.lon, p.lat]);
const closed = (pts: LngLat[]) => (pts.length > 2 && distM(pts[0], pts.at(-1)!) < 0.01 ? pts.slice(0, -1) : pts);
const r6 = (p: LngLat): LngLat => [+p[0].toFixed(6), +p[1].toFixed(6)];

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);
const srcPath = args.find((a) => !a.startsWith('--'));
const withElevation = !args.includes('--no-elevation');
if (!srcPath) {
  console.error('usage: pnpm course:build tools/sources/<course>.json [--no-elevation]');
  process.exit(1);
}
const src = Source.parse(JSON.parse(await readFile(srcPath, 'utf8')));

const [osmType, osmId] = src.osm.course.split('/');
const courseEl = (await overpass(`[out:json][timeout:25];${osmType}(${osmId});out geom;`))[0];
if (!courseEl?.bounds) throw new Error(`OSM ${src.osm.course} not found`);
const outline = osmType === 'way' ? closed(geom(courseEl)) : null;
const b = courseEl.bounds;
const pad = 0.001;
const feat = await overpass(`[out:json][timeout:25];nwr["golf"](${[b.minlat - pad, b.minlon - pad, b.maxlat + pad, b.maxlon + pad].join(',')});out geom tags;`);
const ways = (t: string) => feat.filter((e) => e.type === 'way' && e.tags?.golf === t);

// Course outlines are often loose, so only use one to break ties when the bbox
// holds two holes with the same number (e.g. a neighbouring course).
let holeWays = ways('hole');
if (src.osm.holes) holeWays = holeWays.filter((h) => src.osm.holes!.includes(`way/${h.id}`));
const inside = (h: OsmEl) => !outline || pointInPolygon(centroid(geom(h)), outline);
const pickHole = (n: number) => {
  const ws = holeWays.filter((h) => h.tags?.ref === String(n));
  return ws.find(inside) ?? ws[0];
};

const greens = ways('green').map((e) => closed(geom(e)));
const teeBoxes = ways('tee').map((e) => closed(geom(e)));
const FEATURE = { bunker: 'bunker', water_hazard: 'water', lateral_water_hazard: 'water', fairway: 'fairway' } as const;
const features = feat
  .filter((e) => e.type === 'way' && (e.tags?.golf ?? '') in FEATURE)
  .map((e) => ({ type: FEATURE[e.tags!.golf as keyof typeof FEATURE], polygon: closed(geom(e)) }));

// Give each tee box to one hole: the hole whose start it is nearest, counting
// boxes beside the first stretch of a line (forward tees) as well as behind it.
const teeHole = new Map<LngLat[], OsmEl>();
for (const poly of teeBoxes) {
  const c = centroid(poly);
  let best: OsmEl | null = null, bestD = 120;
  for (const card of src.holes) {
    const h = pickHole(card.number);
    if (!h) continue;
    const p = geom(h);
    const near = nearestOnLine(c, p);
    const d = Math.min(distM(c, p[0]), near.along < lineLengthM(p) * 0.3 ? near.d : Infinity);
    if (d < bestD) { best = h; bestD = d; }
  }
  if (best) teeHole.set(poly, best);
}

const holes: Hole[] = [];
const report: string[] = [];
for (const card of src.holes) {
  const way = pickHole(card.number);
  if (!way) {
    console.warn(`hole ${card.number}: no golf=hole way in OSM, skipped`);
    continue;
  }
  const path = geom(way);
  const end = path.at(-1)!;
  const green = greens.find((g) => pointInPolygon(end, g))
    ?? greens.reduce((best, g) => (distM(centroid(g), end) < distM(centroid(best), end) ? g : best));
  const center = card.greenCenter ?? centroid(green);
  const playLen = lineLengthM(path);

  // Candidate tee boxes with yardage measured like a scorecard: to the line, then along it.
  const boxes = teeBoxes
    .filter((poly) => teeHole.get(poly) === way)
    .map((poly) => {
      const c = centroid(poly);
      const near = nearestOnLine(c, path);
      return { pos: c, yd: (near.d + playLen - near.along) * M_TO_YD };
    });
  if (!boxes.length) boxes.push({ pos: path[0], yd: playLen * M_TO_YD });

  // Each scorecard tee gets the box whose length best fits its yardage.
  const tees: NonNullable<Hole['tees']> = {};
  const cmp: string[] = [];
  for (const t of src.tees) {
    const want = card.yards?.[t.id];
    const fixed = card.teePos?.[t.id];
    const box = fixed
      ? { pos: fixed, yd: (distM(fixed, path[0]) + playLen) * M_TO_YD }
      : want ? boxes.reduce((a, c) => (Math.abs(c.yd - want) < Math.abs(a.yd - want) ? c : a)) : boxes[0];
    tees[t.id] = { pos: r6(box.pos) };
    cmp.push(`${t.id} ${want ?? '-'}/${Math.round(box.yd)}`);
  }

  const hole: Hole = {
    number: card.number,
    par: card.par,
    ...(card.hcp && { hcp: card.hcp }),
    ...(card.yards && { yards: card.yards }),
    tees,
    green: { center: r6(center), polygon: green.map(r6) },
    path: path.map(r6),
    features: features.filter((f) => nearestOnLine(centroid(f.polygon), path).d < 45).map((f) => ({ ...f, polygon: f.polygon.map(r6) })),
  };

  if (withElevation) {
    for (const t of Object.values(tees)) t.elevFt = await elevationFt(t.pos);
    // Sample the green along the approach (front/back) and across it (left/right),
    // 2 m inside the edges, so the app can say which way it tilts.
    const axis = bearing(path.at(-2) ?? path[0], center);
    const sample = async (brg: number) => {
      const { back } = frontBack(center, offset(center, brg, 80), green);
      return elevationFt(offset(center, brg, Math.max(1, back - 2)));
    };
    const c = await elevationFt(center);
    if (c != null) {
      hole.green.elevFt = { center: c, front: await sample(axis + 180), back: await sample(axis), left: await sample(axis - 90), right: await sample(axis + 90) };
    }
    process.stdout.write(`elevation hole ${card.number} ✓\r`);
  }
  holes.push(hole);
  report.push(`  #${String(card.number).padStart(2)} par ${card.par}  card/mapped yd: ${cmp.join('  ')}`);
}

const course = Course.parse({
  id: src.id,
  name: src.name,
  locality: src.locality,
  attribution: `Map data © OpenStreetMap contributors (ODbL)${withElevation ? '; elevation USGS 3DEP' : ''}`,
  tees: src.tees,
  holes,
});
const out = `courses/${course.id}.json`;
await writeFile(out, JSON.stringify(course) + '\n');
console.log(`\n${course.name}: ${holes.length} holes, par ${holes.reduce((s, h) => s + h.par, 0)} → ${out}`);
console.log(report.join('\n'));
