import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import type { MapEvent, MapScope } from '../types';
import { TYPE_COLORS, TYPE_WEIGHTS, type EventType } from '../eventTypes';

// Pre-jittered event used by deck.gl layers. Computed once per data refresh
// in MapView and passed in here so the accessors are pure & stable.
export type JitteredEvent = MapEvent & { jitteredLng: number; jitteredLat: number };

export interface BuildLayersArgs {
    /** Time-window-filtered events. Memoized by the caller so the array reference
     *  is stable across zoom changes — deck.gl skips GPU attribute regen when the
     *  data reference is identity-equal. */
    visible: JitteredEvent[];
    /** Pre-filtered + sorted focal-scope events. null when scope !== 'focal'. */
    personEvents: JitteredEvent[] | null;
    zoom: number;
    scope: MapScope;
    focalPersonId: string | null;
    theme: 'dark' | 'light';
    onEventClick: (evt: MapEvent) => void;
}

/** Deterministic tiny-offset jitter so stacked events at city centroids remain clickable.
 *  Exported so MapView can pre-compute jittered positions on data arrival. */
export function jitterOffset(id: string): [number, number] {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 0.00025; // ≈ 25–30 m in mid-latitudes
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

// Module-scope accessors: stable references across renders so deck.gl can
// skip re-tessellating GPU buffers when only zoom/opacity change.
const getJitteredPosition = (e: JitteredEvent): [number, number] => [e.jitteredLng, e.jitteredLat];
const getRawPosition = (e: MapEvent): [number, number] => [e.lng, e.lat];
const getFillColor = (e: MapEvent): [number, number, number, number] =>
    TYPE_COLORS[e.type as EventType] ?? [200, 200, 200, 220];
const getRadius = (): number => 6;
const getWeight = (e: MapEvent): number => TYPE_WEIGHTS[e.type as EventType] ?? 0.5;
const getPath = (d: { path: [number, number][] }) => d.path;

/** Produce the deck.gl layer array for a given (zoom, data) combo.
 *  Layer order (back-to-front): heatmap → focal-path-halo → focal-path → pins.
 *  Both heatmap + scatter are emitted at every zoom — `visible: false` skips
 *  rendering when opacity would be ~0 but keeps the layer instance and its GPU
 *  resources alive. This avoids the layer add/remove churn that previously
 *  tore down the HeatmapLayer framebuffer at the zoom-3 / zoom-5 thresholds. */
export function buildMapLayers(args: BuildLayersArgs): Layer[] {
    const { visible, personEvents, zoom, theme, onEventClick } = args;

    const heatmapOpacity = zoom < 3 ? 1 : zoom < 5 ? (5 - zoom) / 2 : 0;
    const pinOpacity = zoom >= 5 ? 1 : zoom > 3 ? (zoom - 3) / 2 : 0;

    const layers: Layer[] = [];

    layers.push(new HeatmapLayer<MapEvent>({
        id: 'events-heatmap',
        data: visible,
        visible: heatmapOpacity > 0.02,
        getPosition: getRawPosition,
        getWeight,
        // Constant radiusPixels: changing this prop forces HeatmapLayer to
        // regenerate its weight texture, which causes visible choppiness on
        // zoom. Spec §6.11 calls for 30 → 60 px zoom interpolation; deferred
        // until the perf hit can be addressed (or the layer cached across
        // zoom levels). Phase C reverted this back to the Phase B baseline.
        radiusPixels: 40,
        intensity: 1.2,
        threshold: 0.03,
        opacity: heatmapOpacity,
        // Warm-amber gradient curved via tanh so dense cells don't blow out to white.
        // Stops: cool dim → amber → hot bright.
        colorRange: [
            [8, 16, 40, 0],
            [48, 32, 96, 160],
            [160, 90, 64, 200],
            [236, 170, 70, 230],
            [255, 220, 140, 245],
            [255, 250, 220, 255],
        ],
    }));

    // Connected-path view: only when scope is "focal" (a single person) and the
    // pre-filtered personEvents arg has at least 2 stops. Birth → residences (by
    // sort_date) → death, drawn as a glowing polyline.
    //
    // Two stacked PathLayers — a 5 px halo behind a 3 px stroke — give the line
    // a glow/contrast against either basemap theme without requiring a shader.
    if (personEvents && personEvents.length >= 2) {
        const path = personEvents.map((e) => [e.jitteredLng, e.jitteredLat] as [number, number]);
        const data = [{ path }];
        const haloColor: [number, number, number, number] =
            theme === 'dark' ? [0, 0, 0, 140] : [255, 255, 255, 180];
        const strokeColor: [number, number, number, number] =
            theme === 'dark' ? [236, 170, 70, 230] : [180, 95, 30, 230];
        layers.push(new PathLayer({
            id: 'focal-path-halo',
            data,
            getPath,
            getColor: haloColor,
            getWidth: 5,
            widthUnits: 'pixels',
            jointRounded: true,
            capRounded: true,
        }));
        layers.push(new PathLayer({
            id: 'focal-path',
            data,
            getPath,
            getColor: strokeColor,
            getWidth: 3,
            widthUnits: 'pixels',
            jointRounded: true,
            capRounded: true,
        }));
    }

    layers.push(new ScatterplotLayer<JitteredEvent>({
        id: 'events-pins',
        data: visible,
        visible: pinOpacity > 0.02,
        pickable: true,
        radiusUnits: 'pixels',
        getRadius,
        getFillColor,
        getPosition: getJitteredPosition,
        opacity: pinOpacity,
        onClick: (info) => {
            if (info.object) onEventClick(info.object as MapEvent);
        },
    }));

    return layers;
}
