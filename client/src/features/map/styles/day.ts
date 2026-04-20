import type { StyleSpecification } from 'maplibre-gl';

/** Light (Positron-style) basemap. */
export function dayStyle(pmtilesUrl: string | null): StyleSpecification {
    if (pmtilesUrl) {
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
                { id: 'background', type: 'background', paint: { 'background-color': '#f5f1ea' } },
                {
                    id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth',
                    paint: { 'fill-color': '#ecf0f2' },
                },
                {
                    id: 'water', type: 'fill', source: 'protomaps', 'source-layer': 'water',
                    paint: { 'fill-color': '#d4e2ef' },
                },
                {
                    id: 'roads', type: 'line', source: 'protomaps', 'source-layer': 'roads',
                    minzoom: 8, paint: { 'line-color': '#e8e5dc', 'line-width': 0.8 },
                },
                {
                    id: 'boundaries', type: 'line', source: 'protomaps', 'source-layer': 'boundaries',
                    paint: { 'line-color': '#c7c2b5', 'line-width': 0.5 },
                },
            ],
        };
    }
    return {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '© OpenStreetMap contributors',
            },
        },
        layers: [
            { id: 'osm', type: 'raster', source: 'osm' },
        ],
    };
}
