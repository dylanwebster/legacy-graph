import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Place } from '../schemas/PlaceSchema';
import { GeonamesDb } from './GeonamesDb';

export class GeocodingService {
    private readonly cacheFile: string;
    private readonly geonamesDb: GeonamesDb | null;

    // In-memory cache: lowercase name → Place
    private cache: Map<string, Place> = new Map();
    private cacheLoadPromise: Promise<void> | null = null;

    constructor(dataDir: string, options?: { dbPath?: string }) {
        this.cacheFile = path.join(dataDir, '_meta', '.geocode-cache.json');

        const dbPath = options?.dbPath
            ?? process.env.GEONAMES_DB
            ?? path.join(os.homedir(), '.legacy-graph', 'geonames.db');

        this.geonamesDb = GeonamesDb.fromFile(dbPath);

        if (!this.geonamesDb) {
            console.warn(
                `[GeocodingService] GeoNames database not found at ${dbPath}. ` +
                `Place search will return empty results. Run "npm run geonames:build" to create it.`
            );
        }
    }

    /**
     * Resolve a place name to a Place object, using cache → disk → GeoNames DB.
     * Falls back to { name } if no match found.
     */
    public async resolve(name: string): Promise<Place> {
        await this.ensureCacheLoaded();

        const key = name.toLowerCase();
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }

        const result = this.resolveFromDb(name);
        this.cache.set(key, result);
        await this.persistCache();
        return result;
    }

    /**
     * Search for place candidates. Returns up to `limit` results (default 5).
     * No caching — transient, for type-ahead use.
     */
    public async search(query: string, limit = 5): Promise<Place[]> {
        if (!this.geonamesDb) return [];

        const rows = this.geonamesDb.searchByName(query, limit);
        return rows.map(row => this.rowToPlace(row, query));
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private resolveFromDb(name: string): Place {
        if (!this.geonamesDb) return { name };

        const row = this.geonamesDb.resolveByName(name);
        if (!row) return { name };

        return this.rowToPlace(row, name);
    }

    private rowToPlace(row: { primaryName: string; lat: number; lng: number; countryCode: string | null; admin1Name?: string | null; matchedName: string; sourceType: string }, originalInput: string): Place {
        const place: Place = { name: row.primaryName };

        place.lat = row.lat;
        place.lng = row.lng;

        if (row.countryCode) {
            place.countryCode = row.countryCode;
        }

        if (row.admin1Name) {
            place.admin1Name = row.admin1Name;
        }

        // Set historicalName when the input differs from the modern name
        if (row.primaryName.toLowerCase() !== originalInput.toLowerCase()) {
            place.historicalName = originalInput;
        }

        place.resolvedAt = new Date().toISOString();

        return place;
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
