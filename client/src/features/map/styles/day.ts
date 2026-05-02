import type { StyleSpecification } from 'maplibre-gl';

/** Placeholder light style — replaced by Phase A6 with a `themedStyle('light')`
 *  factory backed by bundled Natural Earth GeoJSON sources. Background-only so
 *  the build compiles between Phase A0 (cleanup) and Phase A6 (rewrite). */
export function dayStyle(): StyleSpecification {
    return {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#e6eef5' } },
        ],
    };
}
