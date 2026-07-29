import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PlaceFeature {
    properties: Record<string, unknown>;
}

// Guards the committed basemap data against regressions when
// scripts/buildBasemap.ts is re-run for a new Natural Earth release.
describe('basemap places.json', () => {
    const placesPath = fileURLToPath(new URL('../../../../public/basemap/places.json', import.meta.url));
    const places = JSON.parse(readFileSync(placesPath, 'utf8')) as { features: PlaceFeature[] };

    it('ships a non-trivial number of places', () => {
        expect(places.features.length).toBeGreaterThan(1000);
    });

    it('contains no place below the minimum renderable rank (rank_max >= 4 at the zoom-8 cap)', () => {
        // The city-label filter threshold interpolates down to 4 at zoom 8 —
        // the basemap zoom cap — so features below rank_max 4 can never render
        // and must be pruned at build time.
        const belowThreshold = places.features.filter(
            (f) => typeof f.properties.rank_max !== 'number' || (f.properties.rank_max as number) < 4,
        );
        expect(belowThreshold.length).toBe(0);
    });

    it('carries only the properties the style reads (name, pop_max, rank_max)', () => {
        const allowed = new Set(['name', 'pop_max', 'rank_max']);
        const extra = new Set<string>();
        for (const f of places.features) {
            for (const key of Object.keys(f.properties)) {
                if (!allowed.has(key)) extra.add(key);
            }
        }
        expect([...extra]).toEqual([]);
    });
});
