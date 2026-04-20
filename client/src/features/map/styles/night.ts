import type { StyleSpecification } from 'maplibre-gl';

/** Dark basemap style. If the local PMTiles build is available, use it as the vector
 *  source; otherwise fall back to OSM raster tiles tinted dark via CSS. Caller decides. */
export function nightStyle(pmtilesUrl: string | null): StyleSpecification {
    if (pmtilesUrl) {
        // Protomaps' "dark" schema via pmtiles:// protocol; real style is produced at runtime
        // by the @protomaps/basemaps theme lib (not installed here). Since this is scaffolding,
        // we use a minimal vector style that just renders land/water from the pmtiles source.
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
    // Raster fallback — OSM tiles, darkened via layer filter. Good enough when PMTiles is absent.
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
            { id: 'background', type: 'background', paint: { 'background-color': '#0b0f1a' } },
            { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-brightness-max': 0.45, 'raster-saturation': -0.5 } },
        ],
    };
}
