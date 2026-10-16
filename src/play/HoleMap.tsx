import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { setWorkerUrl } from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which breaks once bundled;
// let Vite build the worker as its own entry and hand MapLibre the URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import MapGL, { Layer, Marker, Source, type MapRef, type StyleSpecification } from 'react-map-gl/maplibre';
import { bearing, bounds, midpoint, offset, type LngLat } from '../lib/geo';
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
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
};

type Props = {
  hole: Hole;
  from: LngLat; // you, or the tee when you're not on this hole
  here: LngLat | null; // your GPS position, if any
  pin: LngLat;
  target: LngLat | null;
  labels: { pos: LngLat; text: string }[];
  shotLines: [LngLat, LngLat][];
  recenter: number; // bump to re-fit the camera
  onTap: (p: LngLat) => void;
  onClearTarget: () => void;
  onPinMove: (p: LngLat) => void;
  onLongPress?: (p: LngLat) => void;
};

const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
const lineF = (pts: LngLat[], props = {}): Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts } });
const ringF = (poly: LngLat[], type: string) => lineF([...poly, poly[0]], { type });

export function HoleMap(p: Props) {
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const { hole } = p;

  const outlines = useMemo(() => fc([
    ...(hole.features ?? []).map((f) => ringF(f.polygon, f.type)),
    ...(hole.green.polygon ? [ringF(hole.green.polygon, 'green')] : []),
  ]), [hole]);

  // Rotate so you're at the bottom looking up the hole at the green.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const g = hole.green.center;
    const pts = [p.from, ...(hole.green.polygon ?? [g]), offset(g, bearing(p.from, g), 15)];
    m.resize();
    m.fitBounds(bounds(pts), { bearing: bearing(p.from, g), padding: { top: 40, bottom: 60, left: 40, right: 40 }, duration: 0 });
    // Only on hole change / explicit recenter, not on every GPS tick.
  }, [ready, hole, p.recenter]);

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
      attributionControl={{ compact: true, customAttribution: 'Course © OpenStreetMap contributors' }}
      onLoad={(e) => {
        e.target.touchZoomRotate.disableRotation();
        e.target.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        setReady(true);
      }}
      onClick={(e) => p.onTap([e.lngLat.lng, e.lngLat.lat])}
      onContextMenu={(e) => p.onLongPress?.([e.lngLat.lng, e.lngLat.lat])}
    >
      <Source id="hole" type="geojson" data={outlines}>
        <Layer id="outlines" type="line" paint={{
          'line-color': ['match', ['get', 'type'], 'bunker', '#f3e3b0', 'water', '#7cc4ff', 'green', '#b6ff8a', 'rgba(255,255,255,0.35)'],
          'line-width': ['match', ['get', 'type'], 'green', 2, 1],
        }} />
      </Source>
      <Source id="shots" type="geojson" data={fc(p.shotLines.map((l) => lineF(l)))}>
        <Layer id="shots" type="line" paint={{ 'line-color': '#ffd400', 'line-width': 2 }} />
      </Source>
      <Source id="aim" type="geojson" data={fc([lineF(p.target ? [p.from, p.target, p.pin] : [p.from, p.pin])])}>
        <Layer id="aim" type="line" paint={{ 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 2] }} />
      </Source>

      {p.here && <Marker longitude={p.here[0]} latitude={p.here[1]}><div className="dot-player" /></Marker>}
      {p.target && (
        <Marker longitude={p.target[0]} latitude={p.target[1]} onClick={(e) => { e.originalEvent.stopPropagation(); p.onClearTarget(); }}>
          <div className="dot-target" aria-label="Clear target" />
        </Marker>
      )}
      {p.labels.map((l, i) => (
        <Marker key={i} longitude={l.pos[0]} latitude={l.pos[1]}><div className="maplabel">{l.text}</div></Marker>
      ))}
      <Marker
        longitude={p.pin[0]} latitude={p.pin[1]} anchor="bottom-left" offset={[-4, 0]} draggable
        onClick={(e) => e.originalEvent.stopPropagation()}
        onDragEnd={(e) => p.onPinMove([e.lngLat.lng, e.lngLat.lat])}
      >
        <div className="pin" aria-label="Pin (drag to move)">⛳</div>
      </Marker>
    </MapGL>
  );
}

export const labelAt = (a: LngLat, b: LngLat, text: string) => ({ pos: midpoint(a, b), text });
