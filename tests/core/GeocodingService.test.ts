import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GeocodingService } from '../../src/core/GeocodingService';

// Helper to build a minimal Nominatim response
function makeNominatimResponse(
    displayName: string,
    lat: string,
    lng: string,
    countryCode: string
): object {
    return {
        display_name: displayName,
        lat,
        lon: lng,
        address: { country_code: countryCode },
    };
}

function mockFetch(responses: Record<string, object | object[]>) {
    return vi.fn(async (url: string) => {
        const urlStr = String(url);
        const match = Object.keys(responses).find(k => urlStr.includes(k));
        if (!match) {
            throw new Error(`No mock for URL: ${url}`);
        }
        const body = responses[match];
        return {
            ok: true,
            json: async () => body,
        } as unknown as Response;
    });
}

describe('GeocodingService', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geo-test-'));
        await fs.mkdir(path.join(dataDir, '_meta'), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(dataDir, { recursive: true, force: true });
    });

    it('test 1: resolve known city returns lat/lng/countryCode', async () => {
        const fetchFn = mockFetch({
            'nominatim': [
                // Use exact match so display_name === input (no historicalName)
                makeNominatimResponse('London', '51.5074', '-0.1278', 'gb'),
            ],
        });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const result = await svc.resolve('London');

        expect(result.name).toBe('London');
        expect(result.lat).toBeCloseTo(51.5074, 3);
        expect(result.lng).toBeCloseTo(-0.1278, 3);
        expect(result.countryCode).toBe('GB');
        expect(result.historicalName).toBeUndefined();
    });

    it('test 2: resolve unknown place returns { name } fallback', async () => {
        const fetchFn = mockFetch({ 'nominatim': [] });
        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const result = await svc.resolve('Zxqvbjk');

        expect(result.name).toBe('Zxqvbjk');
        expect(result.lat).toBeUndefined();
        expect(result.lng).toBeUndefined();
    });

    it('test 3: resolve network error returns { name } fallback', async () => {
        const fetchFn = vi.fn(async () => { throw new Error('Network error'); });
        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const result = await svc.resolve('London');

        expect(result.name).toBe('London');
        expect(result.lat).toBeUndefined();
    });

    it('test 4: cache hit skips HTTP (fetchFn called only once)', async () => {
        const fetchFn = mockFetch({
            'nominatim': [
                makeNominatimResponse('London, England', '51.5074', '-0.1278', 'gb'),
            ],
        });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        await svc.resolve('London');
        await svc.resolve('London');

        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('test 5: case-insensitive cache: "London" and "london" share entry', async () => {
        const fetchFn = mockFetch({
            'nominatim': [
                makeNominatimResponse('London, England', '51.5074', '-0.1278', 'gb'),
            ],
        });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const r1 = await svc.resolve('London');
        const r2 = await svc.resolve('london');

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(r1.name).toBe(r2.name);
    });

    it('test 6: disk persistence — new instance loads cache without HTTP', async () => {
        const fetchFn = mockFetch({
            'nominatim': [
                makeNominatimResponse('London, England', '51.5074', '-0.1278', 'gb'),
            ],
        });

        // First instance — populates disk cache
        const svc1 = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        await svc1.resolve('London');

        // Second instance — should load from disk, not call fetch
        const fetchFn2 = vi.fn(async () => { throw new Error('Should not be called'); });
        const svc2 = new GeocodingService(dataDir, { fetchFn: fetchFn2 as any });
        const result = await svc2.resolve('London');

        expect(fetchFn2).not.toHaveBeenCalled();
        expect(result.lat).toBeCloseTo(51.5074, 3);
    });

    it('test 7: historicalName set when display_name differs from input', async () => {
        const fetchFn = mockFetch({
            'nominatim': [
                makeNominatimResponse('Kaliningrad, Kaliningrad Oblast, Russia', '54.7104', '20.4522', 'ru'),
            ],
        });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const result = await svc.resolve('Königsberg');

        // The display_name starts with "Kaliningrad" which differs from input "Königsberg"
        expect(result.historicalName).toBe('Königsberg');
        expect(result.name).toContain('Kaliningrad');
    });

    it('test 8: search() returns max 5 results even if Nominatim returns 7', async () => {
        const sevenResults = Array.from({ length: 7 }, (_, i) =>
            makeNominatimResponse(`London ${i}`, '51.5', '-0.1', 'gb')
        );
        const fetchFn = mockFetch({ 'nominatim': sevenResults });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const results = await svc.search('London');

        expect(results.length).toBeLessThanOrEqual(5);
    });

    it('test 9: non-ok HTTP response (503) returns { name } fallback', async () => {
        const fetchFn = vi.fn(async () => ({
            ok: false,
            status: 503,
            json: async () => ({}),
        } as unknown as Response));

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });
        const result = await svc.resolve('London');

        expect(result.name).toBe('London');
        expect(result.lat).toBeUndefined();
    });

    it('test 10: rate limiter — two sequential resolve() calls are ≥1000ms apart', async () => {
        vi.useFakeTimers();
        const timestamps: number[] = [];
        let callCount = 0;

        const fetchFn = vi.fn(async () => {
            timestamps.push(Date.now());
            callCount++;
            return {
                ok: true,
                json: async () => [makeNominatimResponse(`City${callCount}`, '10', '20', 'xx')],
            } as unknown as Response;
        });

        const svc = new GeocodingService(dataDir, { fetchFn: fetchFn as any });

        // First call — fires immediately (no prior request, lastRequestTime=0)
        await svc.resolve('CityA');

        // Second call — must wait ≥1000ms from the first
        const p2 = svc.resolve('CityB');
        // Advance fake time by 1100ms to let the rate-limiter timer fire
        await vi.advanceTimersByTimeAsync(1100);
        await p2;

        expect(timestamps.length).toBe(2);
        const gap = timestamps[1] - timestamps[0];
        expect(gap).toBeGreaterThanOrEqual(1000);

        vi.useRealTimers();
    }, 10000);
});
