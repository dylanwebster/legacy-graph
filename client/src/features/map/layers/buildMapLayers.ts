import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import type { MapEvent, MapScope } from '../types';
import { isEventInWindow } from '../timeStore';
import { TYPE_COLORS, TYPE_WEIGHTS, type EventType } from '../eventTypes';

export interface BuildLayersArgs {
    events: MapEvent[];
    zoom: number;
    windowStart: number;
    windowEnd: number;
    showUndated: boolean;
    scope: MapScope;
    focalPersonId: string | null;
    theme: 'dark' | 'light';
    onEventClick: (evt: MapEvent) => void;
}

// Deterministic tiny-offset jitter so stacked events at city centroids remain clickable.
function jitterOffset(id: string): [number, number] {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 0.00025; // ≈ 25–30 m in mid-latitudes
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** Produce the deck.gl layer array for a given (zoom, data) combo.
 *  Basemap only covers zoom 0–8 (country/state level), so thresholds are tuned
 *  for that range:
 *    zoom <  3   → pure heatmap
 *    3 ≤ zoom <  5 → heatmap fades out, scatterplot fades in
 *    zoom ≥ 5    → scatterplot only (jittered, type-colored) */
export function buildMapLayers(args: BuildLayersArgs): Layer[] {
    const { events, zoom, windowStart, windowEnd, showUndated, onEventClick } = args;

    const visible = events.filter((e) =>
        isEventInWindow(e.sort_date, e.sort_end_date, windowStart, windowEnd, showUndated),
    );

    const heatmapOpacity = zoom < 3 ? 1 : zoom < 5 ? (5 - zoom) / 2 : 0;
    const pinOpacity = zoom >= 5 ? 1 : zoom > 3 ? (zoom - 3) / 2 : 0;

    const layers: Layer[] = [];

    if (heatmapOpacity > 0.02) {
        layers.push(new HeatmapLayer<MapEvent>({
            id: 'events-heatmap',
            data: visible,
            getPosition: (e) => [e.lng, e.lat],
            getWeight: (e) => TYPE_WEIGHTS[e.type as EventType] ?? 0.5,
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
    }

    // Connected-path view: only when scope is "focal" (a single person) and there's a focal id.
    // Birth → residences (by sort_date) → death, drawn as a glowing polyline.
    if (args.scope === 'focal' && args.focalPersonId) {
        const personEvents = events
            .filter((e) => e.person_id === args.focalPersonId && e.sort_date)
            .sort((a, b) => (a.sort_date ?? '').localeCompare(b.sort_date ?? ''));
        if (personEvents.length >= 2) {
            const path = personEvents.map((e) => [e.lng, e.lat] as [number, number]);
            layers.push(new PathLayer({
                id: 'focal-path',
                data: [{ path }],
                getPath: (d) => d.path,
                getColor: args.theme === 'dark' ? [236, 170, 70, 220] : [180, 95, 30, 220],
                getWidth: 2,
                widthUnits: 'pixels',
                jointRounded: true,
                capRounded: true,
            }));
        }
    }

    if (pinOpacity > 0.02) {
        layers.push(new ScatterplotLayer<MapEvent>({
            id: 'events-pins',
            data: visible,
            pickable: true,
            radiusUnits: 'pixels',
            getRadius: 6,
            getFillColor: (e) => TYPE_COLORS[e.type as EventType] ?? [200, 200, 200, 220],
            getPosition: (e) => {
                const [dx, dy] = jitterOffset(e.id);
                return [e.lng + dx, e.lat + dy];
            },
            opacity: pinOpacity,
            onClick: (info) => {
                if (info.object) onEventClick(info.object as MapEvent);
            },
        }));
    }

    return layers;
}
