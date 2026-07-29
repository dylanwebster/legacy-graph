import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import type { MapEvent, MapScope } from '../types';
import { TYPE_COLORS, TYPE_WEIGHTS, type EventType } from '../eventTypes';
import { parseEventYear } from '../timeStore';

// Event enriched with pre-parsed years. Computed once per data refresh in
// MapView (prepareEvents) so the per-frame window filter is pure number math
// and the deck.gl accessors stay pure & stable.
export type PreparedEvent = MapEvent & {
    /** Year of sort_date; null = undated. */
    startYear: number | null;
    /** Year of sort_end_date, falling back to startYear for point events. */
    endYear: number | null;
};

/** Enrich raw API events with pre-parsed years. Called once per data load. */
export function prepareEvents(events: MapEvent[]): PreparedEvent[] {
    return events.map((e) => {
        const startYear = parseEventYear(e.sort_date);
        const endYear = e.sort_end_date ? (parseEventYear(e.sort_end_date) ?? startYear) : startYear;
        return { ...e, startYear, endYear };
    });
}

export interface BuildLayersArgs {
    /** Time-window-filtered events. Memoized by the caller so the array reference
     *  is stable across zoom changes — deck.gl skips GPU attribute regen when the
     *  data reference is identity-equal. */
    visible: PreparedEvent[];
    /** Pre-filtered + sorted focal-scope events. null when scope !== 'focal'. */
    personEvents: PreparedEvent[] | null;
    zoom: number;
    scope: MapScope;
    focalPersonId: string | null;
    theme: 'dark' | 'light';
    onEventClick: (evt: MapEvent) => void;
}

// Module-scope accessors: stable references across renders so deck.gl can
// skip re-tessellating GPU buffers when only zoom/opacity change.
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
        // Constant radiusPixels by design (spec §6.11): changing this prop
        // forces HeatmapLayer to regenerate its weight texture on every zoom
        // frame, causing visible choppiness. A fixed radius keeps the glow
        // stable across the crossfade. Do not move this into updateTriggers.
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
        const path = personEvents.map((e) => [e.lng, e.lat] as [number, number]);
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

    layers.push(new ScatterplotLayer<PreparedEvent>({
        id: 'events-pins',
        data: visible,
        visible: pinOpacity > 0.02,
        pickable: true,
        radiusUnits: 'pixels',
        getRadius,
        getFillColor,
        getPosition: getRawPosition,
        opacity: pinOpacity,
        onClick: (info) => {
            if (info.object) onEventClick(info.object as MapEvent);
        },
    }));

    return layers;
}
