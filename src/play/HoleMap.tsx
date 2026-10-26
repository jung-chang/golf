import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { setWorkerUrl } from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which breaks once bundled;
// let Vite build the worker as its own entry and hand MapLibre the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import MapGL, { Layer, Marker, Source, type MapRef, type StyleSpecification } from 'react-map-gl/maplibre';
import { bearing, bounds, distM, midpoint, offset, type LngLat } from '../lib/geo';
import type { Hole } from '../schemas/course';

setWorkerUrl(workerUrl);

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  // Grass-dark under the imagery: with no signal and no saved tiles, the outlines still read as a course.
  layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#1f3324' } }, { id: 'sat', type: 'raster', source: 'sat' }],
};

type Props = {
  hole: Hole;
  from: LngLat; // you, or the tee when you're not on this hole
  here: LngLat | null; // your GPS position, if any
  hereAcc?: number; // its accuracy, meters (the pale blue halo)
  savedPosition?: LngLat; // correction origin, independent of current GPS
  review?: boolean;
  pin: LngLat;
  target: LngLat | null;
  labels: { pos: LngLat; text: string; offset?: [number, number]; compact?: boolean }[];
  shotLines: [LngLat, LngLat][];
  shotFeatures?: { id: string; start: LngLat; end: LngLat; selected?: boolean; suggested?: boolean }[];
  onSelectShot?: (id: string) => void;
  focusPoints?: LngLat[];
  editing?: { start: LngLat | null; end: LngLat | null; active: 'pos' | 'end'; onPick: (key: 'pos' | 'end') => void; onMove: (key: 'pos' | 'end', pos: LngLat) => void };
  recenter: number; // bump to re-fit the camera
  view?: 'hole' | 'green'; // the whole hole from you, or zoomed on the green
  padBottom?: number; // px hidden under the bottom card
  hazards?: { pos: LngLat; text: string; type: 'bunker' | 'water' }[];
  shotTags?: { pos: LngLat; text: string; shotId?: string; actionLabel?: string; offset?: [number, number] }[];
  onTargetMove?: (p: LngLat) => void;
  pinCallout?: React.ReactNode; // yardages drawn beside the pin (front / center / back)
  padTop?: number; // px kept clear at the top (hole label, location banner)
  onTap: (p: LngLat) => void;
  onClearTarget: () => void;
  onPinMove: (p: LngLat) => void;
};

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const lineF = (pts: LngLat[], props = {}): Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts } });
const ringF = (poly: LngLat[], type: string) => lineF([...poly, poly[0]], { type });
const circleF = (c: LngLat, m: number): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon',
  coordinates: [Array.from({ length: 49 }, (_, i) => offset(c, (i % 48) * 7.5, m))] } });

export function HoleMap(p: Props) {
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { hole } = p;
  useEffect(() => {
    if (!ready || !map.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(old => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(map.current.getContainer());
    return () => observer.disconnect();
  }, [ready]);

  const outlines = useMemo(() => fc([
    ...(hole.features ?? []).map((f) => ringF(f.polygon, f.type)),
    ...(hole.green.polygon ? [ringF(hole.green.polygon, 'green')] : []),
  ]), [hole]);

  // Re-frame once you've walked somewhere new (e.g. from the last green to this tee),
  // but not on GPS jitter, so panning around to look at the hole isn't undone.
  const framedFrom = useRef<LngLat | null>(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (framedFrom.current && distM(framedFrom.current, p.from) > 40) setMoved((n) => n + 1);
  }, [p.from[0], p.from[1]]);

  // Rotate so you're at the bottom looking up the hole at the green.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    framedFrom.current = p.from;
    const g = hole.green.center;
    const recorded = p.shotLines.flat();
    const green = [...(hole.green.polygon ?? [g]), p.pin];
    const pts = p.focusPoints?.length ? p.focusPoints : p.review && recorded.length ? [p.from, ...recorded, p.pin]
      : p.view === 'green' ? [...green, offset(g, bearing(p.from, g), 12), offset(g, bearing(p.from, g) + 180, 12)]
      : [p.from, ...green, offset(g, bearing(p.from, g), 15)];
    m.resize();
    m.fitBounds(bounds(pts), { bearing: bearing(p.from, g), maxZoom: 21, padding: { top: p.review ? (p.padBottom ? 96 : 65) : p.padTop ?? 130, bottom: Math.min((p.padBottom ?? 0) + 80, m.getContainer().clientHeight - 180), left: 56, right: 56 }, duration: p.review ? 0 : 400 });
    // Only on hole change / view change / explicit recenter, not on every GPS tick.
  }, [ready, hole, p.recenter, p.view, p.padBottom, p.padTop, p.review, !!p.focusPoints, moved, size.width, size.height]);

  return (
    <MapGL
      ref={map}
      mapStyle={STYLE}
      initialViewState={{ bounds: bounds([p.from, hole.green.center]) }}
      maxPitch={0}
      maxZoom={21}
      touchPitch={false}
      dragRotate={false}
      touchZoomRotate={{ around: 'center' }}
      attributionControl={false}
      onLoad={(e) => {
        e.target.touchZoomRotate.disableRotation();
        setReady(true);
      }}
      interactiveLayerIds={p.onSelectShot ? ['shot-hit'] : undefined}
      onClick={(e) => {
        if (p.editing) return p.onTap([e.lngLat.lng, e.lngLat.lat]);
        const id = e.features?.[0]?.properties?.id;
        if (id && p.onSelectShot) return p.onSelectShot(String(id));
        if (!p.review) p.onTap([e.lngLat.lng, e.lngLat.lat]);
      }}
    >
      <div aria-label="Map credits" className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-px text-center text-[8px] leading-[10px] text-white/80">
        Imagery © Esri, Maxar, Earthstar Geographics · Course © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a>
      </div>
      <Source id="hole" type="geojson" data={outlines}>
        <Layer id="outlines" type="line" paint={{
          'line-color': ['match', ['get', 'type'], 'bunker', '#f3e3b0', 'water', '#7cc4ff', 'green', '#b6ff8a', 'rgba(255,255,255,0.35)'],
          'line-width': ['match', ['get', 'type'], 'green', 2, 1],
        }} />
      </Source>
      <Source id="acc" type="geojson" data={fc(p.here && p.hereAcc ? [circleF(p.here, Math.max(p.hereAcc, 3))] : [])}>
        <Layer id="acc-fill" type="fill" paint={{ 'fill-color': '#1a73e8', 'fill-opacity': 0.15 }} />
        <Layer id="acc-edge" type="line" paint={{ 'line-color': '#1a73e8', 'line-opacity': 0.4, 'line-width': 1 }} />
      </Source>
      <Source id="shots" type="geojson" data={fc(p.shotFeatures ? p.shotFeatures.map(s => lineF([s.start, s.end], { id: s.id, selected: !!s.selected, suggested: !!s.suggested })) : p.shotLines.map(l => lineF(l)))}>
        <Layer id="shot-hit" type="line" paint={{ 'line-width': 30, 'line-opacity': 0 }} />
        <Layer id="shots-casing" type="line" paint={{ 'line-color': '#000', 'line-opacity': 0.2, 'line-width': 5 }} />
        <Layer id="shots" type="line" paint={{ 'line-color': ['case', ['any', ['boolean', ['get', 'selected'], false], ['boolean', ['get', 'suggested'], false]], '#ffb52e', '#fff'],
          'line-width': 3, 'line-dasharray': [2, 2], 'line-opacity': p.editing ? ['case', ['boolean', ['get', 'selected'], false], 1, 0.18] : 0.9 }} />
      </Source>
      <Source id="aim" type="geojson" data={fc(p.review || p.editing ? [] : [lineF(p.target ? [p.from, p.target, p.pin] : [p.from, p.pin])])}>
        <Layer id="aim-casing" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': 'rgba(0,0,0,0.3)', 'line-width': 4 }} />
        <Layer id="aim" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': '#fff', 'line-width': 2 }} />
      </Source>

      {p.here && <Marker longitude={p.here[0]} latitude={p.here[1]}><div className="dot-player" /></Marker>}
      {p.savedPosition && <Marker longitude={p.savedPosition[0]} latitude={p.savedPosition[1]} anchor="bottom">
        <div role="img" aria-label="Saved stroke position" className="rounded-full border-2 border-white bg-orange-soft px-2 py-1 text-xs font-bold text-orange-strong shadow-md">Saved stroke</div>
      </Marker>}
      {p.shotTags?.map((t, i) => (
        <Marker key={`st${i}`} longitude={t.pos[0]} latitude={t.pos[1]} anchor={t.shotId === 'suggestion' || t.offset ? 'center' : 'left'} offset={t.offset ?? [-6, 0]}>
          {p.onSelectShot && t.shotId ? <button type="button" className={`min-h-11 max-w-[260px] rounded-full border px-3 text-xs font-semibold shadow-md ${t.shotId === 'suggestion' ? 'border-[#f4cc85] bg-[#2c2417]/95 text-[#f4cc85]' : 'border-white/70 bg-black/80 text-white'}`}
            aria-label={t.actionLabel ?? `Edit ${t.text}`} onClick={e => { e.stopPropagation(); p.onSelectShot!(t.shotId!); }}>{t.text}</button>
            : <div className="shot-tag"><i />{t.text}</div>}
        </Marker>
      ))}
      {p.target && (
        <Marker longitude={p.target[0]} latitude={p.target[1]} draggable={!!p.onTargetMove}
          onDragEnd={(e) => p.onTargetMove?.([e.lngLat.lng, e.lngLat.lat])}
          onClick={(e) => { e.originalEvent.stopPropagation(); p.onClearTarget(); }}>
          <div className="dot-target" aria-label="Target (drag to move, tap to reset)"><i /></div>
        </Marker>
      )}
      {p.hazards?.map((h, i) => (
        <Marker key={`hz${i}`} longitude={h.pos[0]} latitude={h.pos[1]}>
          <div className={`maplabel hazard-${h.type}`}>{h.text}</div>
        </Marker>
      ))}
      {p.labels.map((l, i) => (
        <Marker key={i} longitude={l.pos[0]} latitude={l.pos[1]} offset={l.offset}>
          <div className={l.compact ? 'grid size-6 place-content-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-md' : p.review ? 'maplabel review' : 'maplabel'}>{l.text}</div>
        </Marker>
      ))}
      {p.pinCallout && <Marker longitude={p.pin[0]} latitude={p.pin[1]} anchor="left" offset={[24, 0]} style={{ pointerEvents: 'none' }}>{p.pinCallout}</Marker>}
      {p.editing && (['pos', 'end'] as const).map(key => {
        const recorded = key === 'pos' ? p.editing!.start : p.editing!.end;
        const position = recorded ?? (key === 'pos' ? p.from : p.pin);
        const close = distM(p.editing!.start ?? p.from, p.editing!.end ?? p.pin) < 6;
        return <Marker key={key} longitude={position[0]} latitude={position[1]} offset={close ? [key === 'pos' ? -28 : 28, 0] : [0, 0]} draggable
          onClick={e => { e.originalEvent.stopPropagation(); p.editing!.onPick(key); }}
          onDragEnd={e => p.editing!.onMove(key, [e.lngLat.lng, e.lngLat.lat])}>
          <button type="button" aria-label={`${recorded ? 'Move' : 'Set'} shot ${key === 'pos' ? 'start' : 'finish'}`} aria-pressed={p.editing!.active === key}
            className="grid size-11 place-items-center rounded-full border-[3px] border-white bg-[#ffb52e] text-[11px] font-bold text-[#2b1d05] shadow-lg outline-offset-4 aria-pressed:outline-2 aria-pressed:outline-[#ffb52e]"
            onKeyDown={e => {
              const directions: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
              if (!(e.key in directions)) return;
              e.preventDefault(); e.stopPropagation();
              p.editing!.onMove(key, offset(position, bearing(p.from, p.pin) + directions[e.key], 0.9144));
            }}>{recorded ? '' : 'Set '}{key === 'pos' ? 'Start' : 'Finish'}</button>
        </Marker>;
      })}
      <Marker
        longitude={p.pin[0]} latitude={p.pin[1]} anchor="bottom-left" offset={[-4, 2]} draggable={!p.review}
        onClick={(e) => e.originalEvent.stopPropagation()}
        onDragEnd={(e) => p.onPinMove([e.lngLat.lng, e.lngLat.lat])}
      >
        <div className="pin" aria-label={p.review ? 'Estimated pin' : 'Pin (drag to move)'}>
          <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true">
            <ellipse cx="4" cy="31" rx="4" ry="2" fill="rgba(0,0,0,0.45)" />
            <path d="M4 31V3" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M5 3l18 6-18 6z" fill="#e53935" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      </Marker>
    </MapGL>
  );
}

export const labelAt = (a: LngLat, b: LngLat, text: string) => ({ pos: midpoint(a, b), text });
