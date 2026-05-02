import type { StyleSpecification } from 'maplibre-gl';

/** Placeholder dark style — replaced by Phase A6 with a `themedStyle('dark')`
 *  factory backed by bundled Natural Earth GeoJSON sources. Background-only so
 *  the build compiles between Phase A0 (cleanup) and Phase A6 (rewrite). */
export function nightStyle(): StyleSpecification {
    return {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#05090f' } },
        ],
    };
}
