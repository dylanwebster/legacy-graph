import type { StyleSpecification } from 'maplibre-gl';

/** Dark basemap style backed by a Protomaps PMTiles vector source. */
export function nightStyle(pmtilesUrl: string): StyleSpecification {
    return {
        version: 8,
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        sources: {
            protomaps: {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                attribution: '© Protomaps © OpenStreetMap',
            },
        },
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0b0f1a' } },
            {
                id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth',
                paint: { 'fill-color': '#0f1626' },
            },
            {
                id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water',
                paint: { 'fill-color': '#05090f' },
            },
            {
                id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads',
                minzoom: 8, paint: { 'line-color': '#1b2536', 'line-width': 0.6 },
            },
            {
                id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
                paint: { 'line-color': '#24324a', 'line-width': 0.5, 'line-dasharray': [2, 2] },
            },
        ],
    };
}
