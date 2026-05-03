import { describe, it, expect } from 'vitest';
import { buildMapLayers, jitterOffset, type JitteredEvent } from './buildMapLayers';
import type { MapEvent } from '../types';

function makeEvent(overrides: Partial<MapEvent> = {}): MapEvent {
    return {
        id: overrides.id ?? 'e1',
        person_id: overrides.person_id ?? 'p1',
        person_name: overrides.person_name ?? 'Test Person',
        type: overrides.type ?? 'birth',
        lat: overrides.lat ?? 40,
        lng: overrides.lng ?? -74,
        sort_date: overrides.sort_date ?? '1900-01-01',
        sort_end_date: overrides.sort_end_date ?? null,
        has_assets: overrides.has_assets ?? false,
        place_name: overrides.place_name ?? 'New York',
    };
}

function makeJittered(overrides: Partial<MapEvent> = {}): JitteredEvent {
    const e = makeEvent(overrides);
    const [dx, dy] = jitterOffset(e.id);
    return { ...e, jitteredLng: e.lng + dx, jitteredLat: e.lat + dy };
}

const baseArgs = {
    visible: [makeJittered({ id: 'a' }), makeJittered({ id: 'b', type: 'death' })],
    personEvents: null,
    scope: 'all' as const,
    focalPersonId: null,
    theme: 'light' as const,
    onEventClick: () => {},
};

describe('buildMapLayers', () => {
    it('always emits both events-heatmap and events-pins layers', () => {
        for (const zoom of [0, 2, 4, 6, 8]) {
            const layers = buildMapLayers({ ...baseArgs, zoom });
            const ids = layers.map((l) => l.id);
            expect(ids).toContain('events-heatmap');
            expect(ids).toContain('events-pins');
        }
    });

    it('hides the heatmap at high zoom and shows pins; reverses at low zoom', () => {
        const low = buildMapLayers({ ...baseArgs, zoom: 1 });
        const lowHeat = low.find((l) => l.id === 'events-heatmap');
        const lowPins = low.find((l) => l.id === 'events-pins');
        expect(lowHeat?.props.visible).toBe(true);
        expect(lowPins?.props.visible).toBe(false);

        const high = buildMapLayers({ ...baseArgs, zoom: 7 });
        const highHeat = high.find((l) => l.id === 'events-heatmap');
        const highPins = high.find((l) => l.id === 'events-pins');
        expect(highHeat?.props.visible).toBe(false);
        expect(highPins?.props.visible).toBe(true);
    });

    it('crossfades between zoom 3 and 5 — both layers visible in the middle', () => {
        const mid = buildMapLayers({ ...baseArgs, zoom: 4 });
        const heat = mid.find((l) => l.id === 'events-heatmap');
        const pins = mid.find((l) => l.id === 'events-pins');
        expect(heat?.props.visible).toBe(true);
        expect(pins?.props.visible).toBe(true);
    });

    it('keeps heatmap radiusPixels constant (Phase B baseline)', () => {
        // Heatmap radius is fixed at 40 — changing it on zoom forces the
        // weight texture to regenerate, causing visible choppiness.
        const a = buildMapLayers({ ...baseArgs, zoom: 1 });
        const b = buildMapLayers({ ...baseArgs, zoom: 4 });
        const ra = (a.find((l) => l.id === 'events-heatmap')?.props as { radiusPixels?: number }).radiusPixels;
        const rb = (b.find((l) => l.id === 'events-heatmap')?.props as { radiusPixels?: number }).radiusPixels;
        expect(ra).toBe(40);
        expect(rb).toBe(40);
    });

    it('emits no focal-path layers when scope is not focal', () => {
        const layers = buildMapLayers({ ...baseArgs, zoom: 5 });
        const ids = layers.map((l) => l.id);
        expect(ids).not.toContain('focal-path');
        expect(ids).not.toContain('focal-path-halo');
    });

    it('emits no focal-path layers when personEvents has fewer than 2 stops', () => {
        const personEvents = [makeJittered({ id: 'p1-e1' })];
        const layers = buildMapLayers({
            ...baseArgs,
            zoom: 5,
            scope: 'focal',
            focalPersonId: 'p1',
            personEvents,
        });
        const ids = layers.map((l) => l.id);
        expect(ids).not.toContain('focal-path');
        expect(ids).not.toContain('focal-path-halo');
    });

    it('emits a halo + stroke pair (in that order, behind the pins) when focal scope has ≥2 stops', () => {
        const personEvents = [
            makeJittered({ id: 'p1-e1', sort_date: '1900-01-01' }),
            makeJittered({ id: 'p1-e2', sort_date: '1920-01-01', lng: -75 }),
            makeJittered({ id: 'p1-e3', sort_date: '1980-01-01', lng: -76 }),
        ];
        const layers = buildMapLayers({
            ...baseArgs,
            zoom: 5,
            scope: 'focal',
            focalPersonId: 'p1',
            personEvents,
        });
        const ids = layers.map((l) => l.id);
        const haloIdx = ids.indexOf('focal-path-halo');
        const strokeIdx = ids.indexOf('focal-path');
        const pinsIdx = ids.indexOf('events-pins');
        expect(haloIdx).toBeGreaterThanOrEqual(0);
        expect(strokeIdx).toBeGreaterThan(haloIdx);
        expect(pinsIdx).toBeGreaterThan(strokeIdx);
    });

    it('halo is wider than the stroke (5 px vs 3 px)', () => {
        const personEvents = [makeJittered({ id: 'a' }), makeJittered({ id: 'b', lng: -75 })];
        const layers = buildMapLayers({
            ...baseArgs,
            zoom: 5,
            scope: 'focal',
            focalPersonId: 'p1',
            personEvents,
        });
        const halo = layers.find((l) => l.id === 'focal-path-halo');
        const stroke = layers.find((l) => l.id === 'focal-path');
        expect((halo?.props as { getWidth?: number }).getWidth).toBe(5);
        expect((stroke?.props as { getWidth?: number }).getWidth).toBe(3);
    });

    it('keeps layer ids stable across calls (so deck.gl can match instances)', () => {
        const a = buildMapLayers({ ...baseArgs, zoom: 4 }).map((l) => l.id);
        const b = buildMapLayers({ ...baseArgs, zoom: 4 }).map((l) => l.id);
        expect(a).toEqual(b);
    });

    it('jitterOffset is deterministic per id and tiny in magnitude', () => {
        const [dx1, dy1] = jitterOffset('xyz');
        const [dx2, dy2] = jitterOffset('xyz');
        expect(dx1).toBe(dx2);
        expect(dy1).toBe(dy2);
        expect(Math.hypot(dx1, dy1)).toBeLessThan(0.001);
    });
});
