import type { StyleSpecification } from 'maplibre-gl';

/** Single source of truth for basemap layer structure.
 *  Day and night must share identical layer ids/types/order so
 *  `setStyle({ diff: true })` (MapView) patches paint without re-tessellation. */
export function themedStyle(theme: 'light' | 'dark'): StyleSpecification {
    const dark = theme === 'dark';

    // Palette
    const background = dark ? '#05090f' : '#e6eef5';
    const land = dark ? '#0f1626' : '#f8f7f2';
    const water = background;
    const countryLine = dark ? '#24324a' : '#c9c3b5';
    const stateLine = dark ? '#1c2740' : '#dcd5c2';
    const graticuleLine = dark ? '#1b2536' : '#d8d3c7';
    const labelText = dark ? '#cbd5e1' : '#3f3a30';
    const labelHalo = dark ? '#05090f' : '#f8f7f2';
    // State labels are watermark-style: muted, semi-transparent, behind city
    // labels so they read as "place name for the region" not a point.
    const stateLabelText = dark ? '#6b7891' : '#9b937f';

    return {
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {
            countries: { type: 'geojson', data: '/basemap/countries.json' },
            'country-labels': { type: 'geojson', data: '/basemap/country-labels.json' },
            states: { type: 'geojson', data: '/basemap/states.json' },
            'state-labels': { type: 'geojson', data: '/basemap/state-labels.json' },
            lakes: { type: 'geojson', data: '/basemap/lakes.json' },
            places: { type: 'geojson', data: '/basemap/places.json' },
            graticules: { type: 'geojson', data: '/basemap/graticules.json' },
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: { 'background-color': background },
            },
            {
                id: 'country-fill',
                type: 'fill',
                source: 'countries',
                paint: { 'fill-color': land, 'fill-opacity': 1 },
            },
            {
                id: 'lake-fill',
                type: 'fill',
                source: 'lakes',
                paint: { 'fill-color': water, 'fill-opacity': 1 },
            },
            {
                id: 'country-boundary',
                type: 'line',
                source: 'countries',
                paint: { 'line-color': countryLine, 'line-width': 0.7 },
            },
            {
                id: 'state-boundary',
                type: 'line',
                source: 'states',
                minzoom: 3,
                paint: { 'line-color': stateLine, 'line-width': 0.4 },
            },
            {
                id: 'graticules',
                type: 'line',
                source: 'graticules',
                paint: {
                    'line-color': graticuleLine,
                    'line-width': 0.4,
                    'line-dasharray': [2, 2],
                },
            },
            {
                id: 'country-label',
                type: 'symbol',
                source: 'country-labels',
                maxzoom: 5,
                // Per-feature visibility gating: NE marks tiny territories
                // (Clipperton ≈ 7-8, San Marino, Andorra) with high MIN_LABEL
                // so they don't float in the ocean at world view. The +2
                // offset accounts for our renderer's zoom 0-5 range vs NE's
                // tile-schema calibration (USA = 1.7, Mexico = 3): at zoom 0,
                // threshold = 2, so MIN_LABEL ≤ 2 (USA, Brazil, Russia, China,
                // Australia, Canada) all show.
                filter: ['<=', ['to-number', ['get', 'MIN_LABEL'], 0], ['+', ['zoom'], 2]],
                layout: {
                    'text-field': ['get', 'NAME'],
                    'text-font': ['Open Sans Regular'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        2, 10,
                        4, 12,
                        5, 14,
                    ],
                },
                paint: {
                    'text-color': labelText,
                    'text-halo-color': labelHalo,
                    'text-halo-width': 1,
                },
            },
            {
                id: 'state-label',
                type: 'symbol',
                source: 'state-labels',
                minzoom: 4,
                // Per-feature visibility: huge admin_1s (California, Quebec,
                // NSW) have low NE `min_zoom` and appear early; tiny ones
                // (Samoan villages, Caribbean parishes) only show once the
                // zoom level matches their size, preventing pile-up.
                filter: ['<=', ['to-number', ['get', 'min_zoom']], ['zoom']],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Open Sans Regular'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        4, 11,
                        6, 14,
                        8, 18,
                    ],
                    'text-transform': 'uppercase',
                    'text-letter-spacing': 0.18,
                    'text-max-width': 8,
                    // State labels behave like atlas-style watermarks: always
                    // render even if they overlap city/country labels, and
                    // never push city labels aside.
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                },
                paint: {
                    'text-color': stateLabelText,
                    'text-halo-color': labelHalo,
                    'text-halo-width': 1,
                    'text-opacity': 0.7,
                },
            },
            {
                id: 'city-label',
                type: 'symbol',
                source: 'places',
                minzoom: 4,
                filter: [
                    '>=',
                    ['get', 'rank_max'],
                    ['interpolate', ['linear'], ['zoom'], 4, 11, 6, 8, 8, 4],
                ],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Open Sans Regular'],
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        4, 9,
                        6, 11,
                        8, 13,
                    ],
                    'text-anchor': 'top',
                    'text-offset': [0, 0.4],
                    'text-padding': 2,
                    // Cities tied on rank_max (e.g. SF and Oakland are both 12)
                    // need a deterministic tie-breaker — sort by population so
                    // SF (3.45M) wins over Oakland (1.51M). MapLibre draws the
                    // lowest sort-key first, so negate pop_max.
                    'symbol-sort-key': ['-', 0, ['to-number', ['get', 'pop_max'], 0]],
                },
                paint: {
                    'text-color': labelText,
                    'text-halo-color': labelHalo,
                    'text-halo-width': 1,
                },
            },
        ],
    };
}
