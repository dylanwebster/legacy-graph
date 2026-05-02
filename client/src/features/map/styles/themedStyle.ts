import type { StyleSpecification } from 'maplibre-gl';

/** Single source of truth for basemap layer structure.
 *  Day and night must share identical layer ids, types, and order so
 *  `setStyle({ diff: true })` (MapView) patches paint without re-tessellation.
 *  Phase A6 replaces this placeholder with full Natural Earth layers
 *  (countries, states, places, graticules, labels). */
export function themedStyle(theme: 'light' | 'dark'): StyleSpecification {
    const background = theme === 'dark' ? '#05090f' : '#e6eef5';
    return {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': background } },
        ],
    };
}
