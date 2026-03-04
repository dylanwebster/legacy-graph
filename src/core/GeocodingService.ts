import * as fs from 'fs/promises';
import * as path from 'path';
import type { Place } from '../schemas/PlaceSchema';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'LegacyGraph/1.0 (self-hosted genealogy platform)';
const RATE_LIMIT_MS = 1000;

interface NominatimResult {
    display_name: string;
    lat: string;
    lon: string;
    address?: {
        country_code?: string;
    };
}

export class GeocodingService {
    private readonly cacheFile: string;
    private readonly fetchFn: typeof fetch;

    // In-memory cache: lowercase name → Place
    private cache: Map<string, Place> = new Map();
    private cacheLoadPromise: Promise<void> | null = null;

    // Rate limiter: promise queue
    private requestQueue: Promise<void> = Promise.resolve();
    private lastRequestTime = 0;

    constructor(dataDir: string, options?: { fetchFn?: typeof fetch }) {
        this.cacheFile = path.join(dataDir, '_meta', '.geocode-cache.json');
        this.fetchFn = options?.fetchFn ?? fetch;
    }

    /**
     * Resolve a place name to a Place object, using cache → disk → Nominatim.
     * Falls back to { name } on any error.
     */
    public async resolve(name: string): Promise<Place> {
        await this.ensureCacheLoaded();

        const key = name.toLowerCase();
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }

        // Enqueue behind rate limiter
        const result = await this.enqueue(() => this.fetchResolve(name));
        this.cache.set(key, result);
        await this.persistCache();
        return result;
    }

    /**
     * Search for place candidates. Returns up to `limit` results (default 5).
     * No caching — transient, for type-ahead use.
     * Runs through the rate limiter to respect Nominatim's 1 req/s policy.
     */
    public async search(query: string, limit = 5): Promise<Place[]> {
        return this.enqueue(async () => {
            try {
                const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=${limit + 2}`;
                const response = await this.fetchFn(url, {
                    headers: { 'User-Agent': USER_AGENT },
                });

                if (!response.ok) return [];

                const items: NominatimResult[] = await response.json();
                return items.slice(0, limit).map(item => this.itemToPlace(item, query));
            } catch {
                return [];
            }
        });
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private async fetchResolve(name: string): Promise<Place> {
        try {
            const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(name)}&format=jsonv2&addressdetails=1&limit=1`;
            const response = await this.fetchFn(url, {
                headers: { 'User-Agent': USER_AGENT },
            });

            if (!response.ok) return { name };

            const items: NominatimResult[] = await response.json();
            if (!items || items.length === 0) return { name };

            return this.itemToPlace(items[0], name);
        } catch {
            return { name };
        }
    }

    private itemToPlace(item: NominatimResult, originalInput: string): Place {
        const place: Place = { name: item.display_name };

        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (!isNaN(lat)) place.lat = lat;
        if (!isNaN(lng)) place.lng = lng;

        if (item.address?.country_code) {
            place.countryCode = item.address.country_code.toUpperCase();
        }

        // Set historicalName when the resolved name differs from input
        if (item.display_name.toLowerCase() !== originalInput.toLowerCase()) {
            place.historicalName = originalInput;
        }

        place.resolvedAt = new Date().toISOString();

        return place;
    }

    /**
     * Rate-limiter: ensures sequential requests are ≥1000ms apart.
     */
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.requestQueue.then(async () => {
            const now = Date.now();
            const wait = this.lastRequestTime + RATE_LIMIT_MS - now;
            if (wait > 0) {
                await new Promise<void>(resolve => setTimeout(resolve, wait));
            }
            this.lastRequestTime = Date.now();
            return fn();
        });

        // Advance the queue, swallowing errors so the queue never breaks
        this.requestQueue = result.then(() => { }, () => { });

        return result;
    }

    /**
     * Lazy-load the disk cache once. Uses a promise singleton to avoid races.
     */
    private ensureCacheLoaded(): Promise<void> {
        if (!this.cacheLoadPromise) {
            this.cacheLoadPromise = this.loadCacheFromDisk();
        }
        return this.cacheLoadPromise;
    }

    private async loadCacheFromDisk(): Promise<void> {
        try {
            const raw = await fs.readFile(this.cacheFile, 'utf8');
            const data: Array<[string, Place]> = JSON.parse(raw);
            for (const [key, value] of data) {
                this.cache.set(key, value);
            }
        } catch {
            // Cache doesn't exist yet — that's fine
        }
    }

    private async persistCache(): Promise<void> {
        try {
            const dir = path.dirname(this.cacheFile);
            await fs.mkdir(dir, { recursive: true });
            const data = Array.from(this.cache.entries());
            await fs.writeFile(this.cacheFile, JSON.stringify(data), 'utf8');
        } catch {
            // Best-effort — don't crash if persist fails
        }
    }
}
