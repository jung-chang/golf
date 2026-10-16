import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Marker } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import course from '../../courses/clearview-park.json';
import { bearing, bounds, distYd, frontBack, midpoint, M_TO_YD, offset, pointInPolygon, type LngLat } from '../../src/lib/geo';
import { appendAction, fixUsable, greenView, MAX_FIX_AGE_MS, recommend, shotLedger, type Intent, type LocationSample, type ShotAction, type StockClub } from './model';

maplibregl.setWorkerUrl(workerUrl);
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing prototype control: ${id}`);
  return node as T;
}
const hole = course.holes[0];
const center = hole.green.center as LngLat;
const polygon = hole.green.polygon as LngLat[];
const path = hole.path as LngLat[];
const approachBearing = bearing(path.at(-2)!, center);
const stock: StockClub[] = [
  { id: '7i', name: '7i', full: { low: 145, high: 160 }, chip: null, enabled: true },
  { id: '8i', name: '8i', full: { low: 130, high: 145 }, chip: { low: 25, high: 40 }, enabled: true },
  { id: 'pw', name: 'PW', full: { low: 100, high: 115 }, chip: { low: 20, high: 35 }, enabled: true },
  { id: 'sw', name: 'SW', full: { low: 75, high: 90 }, chip: { low: 10, high: 25 }, enabled: true },
];
type GolfView = 'course' | 'green';
let view: GolfView = 'course';
let cameraOverride: GolfView | null = null;
let intent: Intent = 'full';
let pin = [...center] as LngLat;
let pinMoved = false;
let here = offset(center, approachBearing + 180, 150 / M_TO_YD);
let target: LngLat | null = null;
let picked: string | null = null;
let ready = false;
let weakGPS = false;
let pausedGPS = false;
let actions: ShotAction[] = [];
let notice: { text: string; until: number } | null = null;
let map: maplibregl.Map | null = null;
let ballMarker: Marker | null = null;
let pinMarker: Marker | null = null;
let targetMarker: Marker | null = null;
let measureLabels: Marker[] = [];
let samples: Marker[] = [];
let geometryKey = '';
const failures = new Set<string>();
const freshSample = (): LocationSample => ({ pos: [...here], accuracyM: weakGPS ? 20 : 2, acquiredAt: Date.now() });
let fix = freshSample();
const ballNode = document.createElement('button');
ballNode.type = 'button'; ballNode.className = 'ball';
ballNode.setAttribute('aria-label', 'Simulated ball. Drag or use arrow keys to move one yard.');
const pinNode = document.createElement('button');
pinNode.type = 'button'; pinNode.className = 'pin'; pinNode.textContent = '⛳';
pinNode.setAttribute('aria-label', 'Estimated pin. Drag or use arrow keys to move one yard within the green.');
const clubButtons = new Map<string, { button: HTMLButtonElement; range: HTMLElement; hint: HTMLElement }>();
for (const club of stock) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.club = club.id;
  const name = document.createElement('b'); name.textContent = club.name;
  const range = document.createElement('span');
  const hint = document.createElement('small'); hint.className = 'club-help';
  button.append(name, range, hint); el('club-list').append(button);
  clubButtons.set(club.id, { button, range, hint });
}

function rangeLabel(club: StockClub | null) {
  const range = club?.[intent];
  return range ? `${range.low}–${range.high} yd${intent === 'chip' ? ' · chip' : ''}` : `${intent === 'chip' ? 'Chip' : 'Stock'} range not set`;
}
function chosen(now: number) {
  const result = recommend(distYd(here, target ?? pin), stock, fix, now, intent);
  return { result, club: stock.find(c => c.id === picked) ?? result.primary?.club ?? null };
}
function positionFresh(now: number) { return fix.acquiredAt <= now && now - fix.acquiredAt <= MAX_FIX_AGE_MS; }
function showNotice(text: string) { notice = { text, until: Date.now() + 4_000 }; render(); }

function render() {
  const now = Date.now();
  const fresh = positionFresh(now);
  const { result, club } = chosen(now);
  const distance = distYd(here, target ?? pin);
  const approx = weakGPS ? '≈' : '';
  el('yardage').textContent = fresh ? `${approx}${Math.round(distance)}` : '–';
  el('distance-label').textContent = !fresh ? 'Position expired · waiting for fresh GPS' : target ? 'yd to target · tap marker to clear' : pinMoved ? 'yd to manually estimated pin' : 'yd to center · estimated pin';
  el('club-name').textContent = club?.name ?? 'Choose club';
  const reasons = { 'needs-location': fresh ? 'GPS uncertain' : 'Position expired', 'between-clubs': 'Between stock ranges', 'outside-ranges': 'Outside stock ranges', 'no-stock-range': 'No stock range set', suggested: '' };
  el('stock-range').textContent = club ? rangeLabel(club) : reasons[result.status];
  el('mark').textContent = club ? `Start shot · ${club.name}` : 'Choose club for this shot';
  if (!fresh) el('front-back').textContent = 'Live yardages paused';
  else if (pointInPolygon(here, polygon)) el('front-back').textContent = 'On the mapped green · pin is estimated';
  else {
    const fb = frontBack(here, pin, polygon);
    el('front-back').innerHTML = `Front <b>${approx}${Math.round(fb.front * M_TO_YD)}</b> · Back <b>${approx}${Math.round(fb.back * M_TO_YD)}</b>${target ? ` · Then <b>${approx}${Math.round(distYd(target, pin))}</b> to pin` : ''}`;
  }
  el('elevation-note').textContent = !fresh ? 'Simulated GPS paused · manual shot logging remains available' : weakGPS ? `Simulated GPS ±${Math.round(fix.accuracyM * M_TO_YD)} yd · automatic suggestion paused` : view === 'green' ? 'Approximate relief only · back sampled 2.4 ft above front' : 'Sample stock total distances · simulated GPS ±2 yd';
  el('course-view').setAttribute('aria-pressed', String(view === 'course'));
  el('green-view').setAttribute('aria-pressed', String(view === 'green'));
  el('full-shot').setAttribute('aria-pressed', String(intent === 'full'));
  el('chip-shot').setAttribute('aria-pressed', String(intent === 'chip'));
  el('map-caption').textContent = !fresh ? 'Last position shown · live yardages paused' : view === 'green' ? 'Estimated pin · elevation samples, not contours' : 'Pinch to zoom · twist to rotate · two fingers to tilt';
  el('map-caption').hidden = !ready;
  el<HTMLButtonElement>('recenter').disabled = !ready;
  const ledger = shotLedger(actions);
  const guidance = ledger.putts > 0
    ? `Putt ${ledger.putts} counted. Start each remaining putt before hitting. When holed out, the hole is done.`
    : ledger.pending
      ? `Shot ${ledger.shots} started. Hit, then walk to your ball. Your next Start shot or Start putt finishes measuring this shot.`
      : 'Choose your club, then Start shot. At the next ball position, start your next shot to measure the previous one.';
  if (el('shot-guidance').textContent !== guidance) el('shot-guidance').textContent = guidance;
  const last = ledger.completed.at(-1)?.measurement;
  const counts = `${ledger.shots} ${ledger.shots === 1 ? 'shot' : 'shots'} · ${ledger.putts} ${ledger.putts === 1 ? 'putt' : 'putts'}`;
  const lastDistance = last ? last.usableForStats && last.yards != null ? ` · last ${Math.round(last.yards)} yd` : ' · distance uncertain' : '';
  const excludedStart = ledger.pending && !fixUsable(ledger.pending.action.fix, ledger.pending.action.fix.markedAt, ledger.pending.action.intent);
  const status = notice && notice.until > now ? notice.text : actions.length ? `${counts}${lastDistance}${excludedStart ? ' · GPS excluded' : ''}` : 'Ready for your first shot';
  if (el('shot-status').textContent !== status) el('shot-status').textContent = status;
  el('measurement-status').textContent = last?.envelope ? `Last completed shot envelope: ${last.envelope.low.toFixed(1)}–${last.envelope.high.toFixed(1)} yd. ${last.usableForStats ? 'Quality gates passed.' : 'Excluded from statistics.'}` : 'No completed shot distance yet.';
  el<HTMLButtonElement>('undo').disabled = !actions.length;
  for (const c of stock) {
    const nodes = clubButtons.get(c.id)!;
    nodes.button.setAttribute('aria-pressed', String(c.id === club?.id));
    nodes.range.textContent = rangeLabel(c);
    nodes.hint.textContent = c.id === picked ? 'Manual choice' : result.alternatives.some(a => a.club.id === c.id) ? 'Also plausible' : '';
    nodes.hint.hidden = !nodes.hint.textContent;
  }
  ballNode.classList.toggle('position-expired', !fresh);
  samples.forEach(marker => { marker.getElement().hidden = view !== 'green'; });
  if (!ready || !map) return;
  // Repainting the clock must not recreate markers, reload sources, or steal focus.
  const key = JSON.stringify([here, pin, target, view, fresh, weakGPS]);
  if (geometryKey === key) return;
  geometryKey = key;
  const line = target ? [here, target, pin] : [here, pin];
  const source = map.getSource('aim') as GeoJSONSource | undefined;
  source?.setData(fresh ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } } : { type: 'FeatureCollection', features: [] });
  measureLabels.forEach(marker => marker.remove()); measureLabels = [];
  if (fresh) measureLabels = line.slice(1).map((to, i) => {
    const node = document.createElement('div'); node.className = 'distance-label';
    node.textContent = `${approx}${Math.round(distYd(line[i], to))} yd`;
    const anchor = view === 'green' && !target && distYd(here, center) > 90 ? offset(pin, bearing(pin, here), 8) : midpoint(line[i], to);
    return new maplibregl.Marker({ element: node, offset: [30, 0] }).setLngLat(anchor).addTo(map!);
  });
  targetMarker?.remove(); targetMarker = null;
  if (target && fresh) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'target'; node.setAttribute('aria-label', 'Clear target');
    node.addEventListener('click', e => { e.stopPropagation(); target = null; render(); });
    targetMarker = new maplibregl.Marker({ element: node }).setLngLat(target).addTo(map);
  }
}

function recenter() {
  if (!map || !ready) return;
  const points = view === 'green' ? [...polygon, ...(distYd(here, center) <= 90 ? [here] : [])] : [...path, ...polygon, here];
  map.fitBounds(bounds(points), { padding: { top: 90, bottom: 65, left: 45, right: 45 }, bearing: approachBearing, pitch: view === 'green' ? 0 : 45, maxZoom: view === 'green' ? 20.2 : 18.5, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 });
}
function setView(next: GolfView, manual = true) {
  if (manual) cameraOverride = next;
  view = next; render(); recenter();
}
function moveBall(position: LngLat) {
  here = position; fix = freshSample(); ballMarker?.setLngLat(here);
  const next = greenView(distYd(here, pin), view, fixUsable(fix, Date.now(), 'full'), cameraOverride);
  if (next !== view) setView(next, false);
  else render();
}
function movePin(position: LngLat) {
  if (!pointInPolygon(position, polygon)) { pinMarker?.setLngLat(pin); return showNotice('Keep the estimated pin on the mapped green'); }
  pin = position; pinMoved = true; pinMarker?.setLngLat(pin); render();
}
function placeDemo(chip: boolean) {
  // Only explicit debug controls change the simulated location and shot intent.
  cameraOverride = null; intent = chip ? 'chip' : 'full'; picked = null; target = null;
  moveBall(offset(center, approachBearing + 180, (chip ? 22 : 150) / M_TO_YD));
  recenter();
}
function markerKeys(node: HTMLElement, position: () => LngLat, move: (p: LngLat) => void) {
  node.addEventListener('keydown', e => {
    const angles: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
    if (!(e.key in angles)) return;
    e.preventDefault(); e.stopPropagation();
    move(offset(position(), (map?.getBearing() ?? 0) + angles[e.key], 1 / M_TO_YD));
  });
}
markerKeys(ballNode, () => here, moveBall); markerKeys(pinNode, () => pin, movePin);

function detachMap() {
  ready = false; geometryKey = '';
  ballMarker?.remove(); pinMarker?.remove(); targetMarker?.remove();
  measureLabels.forEach(m => m.remove()); samples.forEach(m => m.remove());
  ballMarker = null; pinMarker = null; targetMarker = null; measureLabels = []; samples = [];
  const old = map; map = null; old?.remove();
}
function mapFailure(error: unknown) {
  detachMap();
  el('map').replaceChildren();
  el('map-fallback').hidden = false;
  el('map-status').textContent = `Map unavailable: ${error instanceof Error ? error.message : 'initialization failed'}. Numeric tracking is still available.`;
  render();
}
function updateMapStatus() {
  if (!map || !ready) return;
  const terrain = map.queryTerrainElevation(center);
  el('map-status').textContent = `${terrain == null ? 'Terrain not loaded' : `Terrain loaded (${terrain.toFixed(1)} m at green)`} · pitch ${Math.round(map.getPitch())}° · rotation ${Math.round(map.getBearing())}°${failures.size ? ` · ${failures.size} map request errors` : ''}. Physical gestures and outdoor GPS still need phone testing.`;
}
function separateElevationLabels() {
  if (!map || !ready) return;
  const middle = map.project(center);
  for (const marker of samples) {
    const p = map.project(marker.getLngLat());
    const dx = p.x - middle.x, dy = p.y - middle.y, length = Math.hypot(dx, dy) || 1;
    marker.setOffset([dx / length * 32 - (Math.abs(dx) < Math.abs(dy) ? 15 : 0), dy / length * 16]);
  }
}
function initMap() {
  try {
    if (new URLSearchParams(location.search).has('noMap')) throw new Error('Simulated map initialization failure');
    const m = new maplibregl.Map({
      container: 'map', center, zoom: 17, maxZoom: 21, maxPitch: 60, pitch: 45,
      touchPitch: true, touchZoomRotate: true, dragRotate: true, attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
          terrain: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Terrain: AWS Open Data / Mapzen; course © OpenStreetMap contributors' },
        },
        layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }], terrain: { source: 'terrain', exaggeration: 1 },
      },
    });
    map = m;
    ballMarker = new maplibregl.Marker({ element: ballNode, draggable: true }).setLngLat(here).addTo(m);
    pinMarker = new maplibregl.Marker({ element: pinNode, draggable: true, anchor: 'bottom' }).setLngLat(pin).addTo(m);
    ballMarker.on('dragend', () => { const p = ballMarker!.getLngLat(); moveBall([p.lng, p.lat]); });
    pinMarker.on('dragend', () => { const p = pinMarker!.getLngLat(); movePin([p.lng, p.lat]); });
    m.on('load', () => {
      try {
        m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        m.addSource('green', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...polygon, polygon[0]]] } } });
        m.addLayer({ id: 'green-fill', type: 'fill', source: 'green', paint: { 'fill-color': '#9be66e', 'fill-opacity': 0.12 } });
        m.addLayer({ id: 'green-edge', type: 'line', source: 'green', paint: { 'line-color': '#b6ff8a', 'line-width': 2 } });
        m.addSource('aim', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({ id: 'aim', type: 'line', source: 'aim', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 2] } });
        const heights = hole.green.elevFt;
        const directions = [{ label: 'Back', bearing: approachBearing, height: heights.back }, { label: 'Front', bearing: approachBearing + 180, height: heights.front }, { label: 'Left', bearing: approachBearing - 90, height: heights.left }, { label: 'Right', bearing: approachBearing + 90, height: heights.right }];
        for (const d of directions) {
          const edge = frontBack(center, offset(center, d.bearing, 80), polygon).back;
          const position = offset(center, d.bearing, Math.max(1, edge - 2));
          const node = document.createElement('div'); node.className = 'sample-label';
          const change = d.height - heights.center;
          node.textContent = `${d.label} ${change >= 0 ? '+' : ''}${change.toFixed(1)} ft`;
          samples.push(new maplibregl.Marker({ element: node }).setLngLat(position).addTo(m));
        }
        ready = true; render(); recenter();
      } catch (error) { mapFailure(error); }
    });
    m.on('idle', updateMapStatus); m.on('moveend', updateMapStatus); m.on('move', separateElevationLabels);
    m.on('error', e => { failures.add(e.error.message); el('map-status').textContent = `Map tiles may be incomplete (${failures.size} request errors). Numeric tracking remains available.`; });
    m.on('click', e => { if (e.originalEvent.target instanceof Element && e.originalEvent.target.closest('.maplibregl-marker')) return; target = [e.lngLat.lng, e.lngLat.lat]; render(); });
  } catch (error) { mapFailure(error); }
}

el('course-view').addEventListener('click', () => setView('course'));
el('green-view').addEventListener('click', () => setView('green'));
el('demo-approach').addEventListener('click', () => placeDemo(false));
el('demo-chip').addEventListener('click', () => placeDemo(true));
el('recenter').addEventListener('click', recenter);
el('club-choice').addEventListener('click', () => el<HTMLDialogElement>('clubs').showModal());
el('full-shot').addEventListener('click', () => { intent = 'full'; picked = null; render(); });
el('chip-shot').addEventListener('click', () => { intent = 'chip'; picked = null; render(); });
el('club-list').addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-club]');
  if (button) { picked = button.dataset.club!; el<HTMLDialogElement>('clubs').close(); render(); }
});
el<HTMLInputElement>('weak-gps').addEventListener('change', e => { weakGPS = (e.target as HTMLInputElement).checked; fix = freshSample(); render(); });
el<HTMLInputElement>('pause-gps').addEventListener('change', e => { pausedGPS = (e.target as HTMLInputElement).checked; if (!pausedGPS) fix = freshSample(); render(); });
el('mark').addEventListener('click', () => {
  const now = Date.now(), { club } = chosen(now);
  if (!club) return el<HTMLDialogElement>('clubs').showModal();
  const action: ShotAction = { type: 'shot', club: club.id, intent, fix: { ...fix, pos: [...fix.pos], markedAt: now } };
  const result = appendAction(actions, action);
  if (result.duplicate) return showNotice('Shot already marked · Undo to correct');
  actions = result.actions; notice = null; picked = null; target = null; render();
});
el('putt').addEventListener('click', () => { actions.push({ type: 'putt', club: 'pt', intent: 'chip', fix: { ...fix, pos: [...fix.pos], markedAt: Date.now() } }); notice = null; render(); });
el('undo').addEventListener('click', () => { actions.pop(); notice = null; render(); });
render();
initMap();
const clock = setInterval(() => {
  if (!pausedGPS && document.visibilityState === 'visible') fix = freshSample();
  render();
}, 1_000);
import.meta.hot?.dispose(() => { clearInterval(clock); detachMap(); });
