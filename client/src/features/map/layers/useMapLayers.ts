import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Layer } from '@deck.gl/core';
import type { MapEvent, MapScope } from '../types';
import { isEventInWindow } from '../timeStore';

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

// Weights used to feed HeatmapLayer; birth/death/marriage carry more mass than
// decadal records like census. Scaled loosely so one marriage ≈ 1 "light".
const TYPE_WEIGHTS: Record<string, number> = {
    birth: 1.0, death: 1.0, marriage: 1.0, divorce: 0.7,
    engagement: 0.6, residence: 0.6, occupation: 0.6,
    education: 0.5, military_service: 0.6,
    baptism: 0.5, burial: 0.5,
    immigration: 0.7, emigration: 0.7, adoption: 0.6,
    census: 0.3, generic: 0.4,
};

// Distinct colors per event type for the zoomed-in pin layer.
const TYPE_COLORS: Record<string, [number, number, number, number]> = {
    birth: [74, 222, 128, 220],        // emerald
    death: [148, 163, 184, 220],       // slate
    marriage: [250, 204, 21, 220],     // gold
    divorce: [239, 68, 68, 220],       // red
    engagement: [244, 114, 182, 220],  // pink
    residence: [59, 130, 246, 220],    // blue
    occupation: [168, 85, 247, 220],   // purple
    education: [14, 165, 233, 220],    // sky
    military_service: [120, 113, 108, 220], // stone
    baptism: [134, 239, 172, 220],     // mint
    burial: [71, 85, 105, 220],        // deep slate
    immigration: [34, 197, 94, 220],   // green
    emigration: [249, 115, 22, 220],   // orange
    adoption: [217, 70, 239, 220],     // fuchsia
    census: [161, 161, 170, 220],      // zinc
    generic: [100, 116, 139, 220],     // slate-blue
};

// Deterministic tiny-offset jitter so stacked events at city centroids remain clickable.
function jitterOffset(id: string): [number, number] {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    const angle = (h % 360) * (Math.PI / 180);
    const radius = 0.00025; // ≈ 25–30 m in mid-latitudes
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** Produce the deck.gl layer array for a given (zoom, data) combo.
 *  Crossfade logic:
 *    zoom <  6   → pure heatmap
 *    6 ≤ zoom <  12 → heatmap fading out, scatterplot fading in
 *    zoom ≥ 12   → scatterplot only (jittered, type-colored) */
export function buildMapLayers(args: BuildLayersArgs): Layer[] {
    const { events, zoom, windowStart, windowEnd, showUndated, onEventClick } = args;

    const visible = events.filter((e) =>
        isEventInWindow(e.sort_date, e.sort_end_date, windowStart, windowEnd, showUndated),
    );

    const heatmapOpacity = zoom < 6 ? 1 : zoom < 9 ? (9 - zoom) / 3 : 0;
    const pinOpacity = zoom > 12 ? 1 : zoom > 6 ? (zoom - 6) / 6 : 0;

    const layers: Layer[] = [];

    if (heatmapOpacity > 0.02) {
        layers.push(new HeatmapLayer<MapEvent>({
            id: 'events-heatmap',
            data: visible,
            getPosition: (e) => [e.lng, e.lat],
            getWeight: (e) => TYPE_WEIGHTS[e.type] ?? 0.5,
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
            getFillColor: (e) => TYPE_COLORS[e.type] ?? [200, 200, 200, 220],
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
