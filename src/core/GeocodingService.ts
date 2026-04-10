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

        // Parse comma-separated parts: "Mountain, Grizzly Flats, El Dorado, CA, USA"
        // → ["Mountain", "Grizzly Flats", "El Dorado", "CA", "USA"]
        const parts = query.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return [];

        // Try each part as the place name, with remaining parts as qualifiers.
        // This handles overly-specific genealogy strings where the first parts
        // (e.g. "Mountain") aren't real places but later parts are.
        for (let i = 0; i < parts.length; i++) {
            const placeName = parts[i];
            const qualifiers = parts.slice(i + 1);

            if (qualifiers.length === 0) {
                const rows = this.geonamesDb.searchByName(placeName, limit);
                if (rows.length > 0) {
                    return this.deduplicatePlaces(rows.map(row => this.searchRowToPlace(row)), limit);
                }
            } else {
                // Try with all qualifiers first, then progressively drop the
                // most-specific (leftmost) ones. This handles qualifiers that
                // reference admin levels we don't support (e.g. ADM3 communes).
                // "Acquaviva, Camaiore, Lucca, Italy" → try ["Camaiore","Lucca","Italy"],
                // then ["Lucca","Italy"], then ["Italy"].
                for (let q = 0; q < qualifiers.length; q++) {
                    const subset = qualifiers.slice(q);
                    const rows = this.geonamesDb.searchFiltered(placeName, subset, limit);
                    if (rows.length > 0) {
                        return this.deduplicatePlaces(rows.map(row => this.searchRowToPlace(row)), limit);
                    }
                }
            }
        }

        return [];
    }

    /**
     * Deduplicate places that would display identically in the dropdown
     * (same name, admin1, admin2, country).
     */
    private deduplicatePlaces(places: Place[], limit: number): Place[] {
        const seen = new Set<string>();
        const result: Place[] = [];
        for (const p of places) {
            // Use the displayed admin2 for dedup (hidden when it matches the place name)
            const displayAdmin2 = (p.admin2Name && p.admin2Name !== p.name) ? p.admin2Name : '';
            const key = `${p.name}|${p.admin1Name ?? ''}|${displayAdmin2}|${p.countryCode ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(p);
            if (result.length >= limit) break;
        }
        return result;
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private resolveFromDb(name: string): Place {
        if (!this.geonamesDb) return { name };

        const row = this.geonamesDb.resolveByName(name);
        if (!row) return { name };

        return this.rowToPlace(row, name);
    }

    /**
     * Convert a search result row to a Place, using the matched alternate name
     * as the place name so search results reflect what the user typed.
     */
    private searchRowToPlace(row: { primaryName: string; lat: number; lng: number; countryCode: string | null; admin1Name?: string | null; admin2Name?: string | null; matchedName: string; sourceType: string }): Place {
        const place: Place = { name: row.matchedName };

        place.lat = row.lat;
        place.lng = row.lng;

        if (row.countryCode) {
            place.countryCode = row.countryCode;
        }

        if (row.admin1Name) {
            place.admin1Name = row.admin1Name;
        }

        if (row.admin2Name) {
            place.admin2Name = row.admin2Name;
        }

        place.resolvedAt = new Date().toISOString();

        return place;
    }

    private rowToPlace(row: { primaryName: string; lat: number; lng: number; countryCode: string | null; admin1Name?: string | null; admin2Name?: string | null; matchedName: string; sourceType: string }, originalInput: string): Place {
        const place: Place = { name: row.primaryName };

        place.lat = row.lat;
        place.lng = row.lng;

        if (row.countryCode) {
            place.countryCode = row.countryCode;
        }

        if (row.admin1Name) {
            place.admin1Name = row.admin1Name;
        }

        if (row.admin2Name) {
            place.admin2Name = row.admin2Name;
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
