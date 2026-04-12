import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Place } from '../schemas/PlaceSchema';
import { GeonamesDb, type GeonamesRow } from './GeonamesDb';

export interface BatchSearchResult {
    place: Place | null;
    confidence: 'high' | 'medium' | 'low' | 'none';
    droppedParts: string[];   // Parts before firstFoundAt (candidate site_name)
    resultCount: number;
}

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
                `[GeocodingService] GeoNames database not found or incompatible at ${dbPath}. ` +
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
        // Overly-specific genealogy strings like "Mountain, Grizzly Flats, El
        // Dorado, CA, USA" will skip "Mountain" (no match with tight qualifiers)
        // and find "Grizzly Flats" at i=1. Once results are found, only try one
        // more part to avoid treating admin/country qualifiers as place names.
        const collected: Place[] = [];
        const seenGeonameIds = new Set<string>();
        let firstFoundAt = -1;

        for (let i = 0; i < parts.length && collected.length < limit; i++) {
            // Stop searching after one part beyond the first successful match
            if (firstFoundAt >= 0 && i > firstFoundAt + 1) break;

            const placeName = parts[i];
            const qualifiers = parts.slice(i + 1);

            let rows: ReturnType<typeof this.geonamesDb.searchByName> = [];

            if (qualifiers.length === 0 && i === 0) {
                // Only search the last part standalone when it's the entire query
                // (no commas). Otherwise "CA" or "FR" at the end would match
                // unrelated places.
                rows = this.geonamesDb.searchByName(placeName, limit);
            } else if (qualifiers.length === 0) {
                // Skip trailing parts with no qualifiers (e.g. "USA" in
                // "Mountain, Grizzly Flats, El Dorado, CA, USA")
                continue;
            } else if (i > 0 && placeName.length <= 3) {
                // Skip short parts (≤3 chars) as place names when they follow
                // the first part — these are almost always admin/country codes
                // ("MA", "CA", "USA") and cause catastrophically slow FTS prefix
                // queries against millions of rows.
                continue;
            } else {
                // Try with all qualifiers first, then drop at most one from the
                // left. This handles a single unrecognized admin level (e.g.
                // ADM3 communes) without discarding meaningful geographic
                // context like locality names.
                const maxDrop = Math.min(1, qualifiers.length - 1);
                for (let q = 0; q <= maxDrop; q++) {
                    const subset = qualifiers.slice(q);
                    rows = this.geonamesDb.searchFiltered(placeName, subset, limit);
                    if (rows.length > 0) break;
                }
            }

            if (rows.length > 0 && firstFoundAt < 0) {
                firstFoundAt = i;
            }

            for (const row of rows) {
                const key = String(row.geonameid);
                if (seenGeonameIds.has(key)) continue;
                seenGeonameIds.add(key);
                collected.push(this.searchRowToPlace(row));
                if (collected.length >= limit) break;
            }
        }

        return this.deduplicatePlaces(collected, limit);
    }

    /**
     * Search for a place and return metadata for batch geocoding: confidence
     * scoring, which parts were dropped (for site_name extraction), and result count.
     * Tuned for fully-specified place strings (GEDCOM locations), not type-ahead.
     * Does NOT use or write to the cache.
     */
    public async searchWithMetadata(query: string): Promise<BatchSearchResult> {
        const noMatch: BatchSearchResult = { place: null, confidence: 'none', droppedParts: [], resultCount: 0 };
        if (!this.geonamesDb) return noMatch;

        const parts = query.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length === 0) return noMatch;

        const firstPart = parts[0];
        const qualifiers = parts.slice(1);

        // ── Special case: country name lookup ──
        // Check if the full input or first part matches a country name
        if (parts.length <= 2) {
            const lookupStr = parts.length === 1 ? firstPart : parts.join(', ');
            const countryCode = this.geonamesDb.resolveCountryCode(lookupStr);
            if (countryCode) {
                const countryRow = this.geonamesDb.lookupCountryPcl(countryCode);
                if (countryRow) {
                    const place = this.searchRowToPlace(countryRow);
                    const confidence = firstPart.length <= 5 && !qualifiers.length ? 'medium' as const : 'high' as const;
                    return { place, confidence, droppedParts: [], resultCount: 1 };
                }
            }
        }

        // ── Special case: state/admin1 abbreviation (2-3 char first part) ──
        if (firstPart.length <= 3 && firstPart.length >= 2 && /^[a-zA-Z]+$/.test(firstPart)) {
            // Resolve country from qualifiers if present (countries table only, fast)
            let countryCode: string | undefined;
            if (qualifiers.length > 0) {
                const lastQual = qualifiers[qualifiers.length - 1];
                countryCode = this.geonamesDb.resolveCountryCode(lastQual)
                    ?? (lastQual.length === 2 ? lastQual.toUpperCase() : undefined);
            }

            // US-first: try US, then specified country, then any
            const admin1Row =
                this.geonamesDb.lookupAdmin1ByCode(firstPart, countryCode || 'US') ||
                (countryCode && countryCode !== 'US'
                    ? this.geonamesDb.lookupAdmin1ByCode(firstPart, countryCode)
                    : null) ||
                (!countryCode
                    ? this.geonamesDb.lookupAdmin1ByCode(firstPart)
                    : null);

            if (admin1Row) {
                const place = this.searchRowToPlace(admin1Row);
                const confidence = qualifiers.length > 0 ? 'medium' as const : 'low' as const;
                return { place, confidence, droppedParts: [], resultCount: 1 };
            }
        }

        // ── Special case: single-part input that matches a state/admin1 name ──
        // For batch geocoding, "Virginia" or "California" as a standalone input
        // should resolve to the state, not a city of the same name in another state.
        if (parts.length === 1 && firstPart.length >= 4) {
            const rows = this.geonamesDb.searchByName(firstPart, 5);
            const adm1Match = rows.find(r =>
                r.featureCode.startsWith('ADM1') &&
                r.primaryName.toLowerCase() === firstPart.toLowerCase()
            );
            if (adm1Match) {
                const place = this.searchRowToPlace(adm1Match);
                const confidence = adm1Match.population >= 500000 ? 'high' as const : 'medium' as const;
                return { place, confidence, droppedParts: [], resultCount: 1 };
            }
            // Also check for country names via FTS (e.g., "England" as an ADM1 in GB)
            const countryOrRegion = rows.find(r =>
                (r.featureCode.startsWith('PCL') || r.featureCode.startsWith('ADM1')) &&
                r.matchedName.toLowerCase() === firstPart.toLowerCase()
            );
            if (countryOrRegion) {
                const place = this.searchRowToPlace(countryOrRegion);
                return { place, confidence: 'medium', droppedParts: [], resultCount: 1 };
            }
        }

        // ── Standard multi-part search (mirrors search() but with metadata) ──
        let firstFoundAt = -1;
        let bestRows: GeonamesRow[] = [];
        let qualifiersDropped = 0;
        const limit = 5;

        for (let i = 0; i < parts.length; i++) {
            if (firstFoundAt >= 0 && i > firstFoundAt + 1) break;

            const placeName = parts[i];
            const partQualifiers = parts.slice(i + 1);

            let rows: GeonamesRow[] = [];

            if (partQualifiers.length === 0 && i === 0) {
                rows = this.geonamesDb.searchByName(placeName, limit);
            } else if (partQualifiers.length === 0) {
                continue;
            } else if (i > 0 && placeName.length <= 3) {
                continue;
            } else {
                const maxDrop = Math.min(1, partQualifiers.length - 1);
                for (let q = 0; q <= maxDrop; q++) {
                    const subset = partQualifiers.slice(q);
                    rows = this.geonamesDb.searchFiltered(placeName, subset, limit);
                    if (rows.length > 0) {
                        if (firstFoundAt < 0) qualifiersDropped = q;
                        break;
                    }
                }
            }

            if (rows.length > 0 && firstFoundAt < 0) {
                firstFoundAt = i;
                bestRows = rows;
            }
        }

        if (bestRows.length === 0) return noMatch;

        // ── Post-process: prefer PPL over ADM when names overlap ──
        // When the top result is an ADM (county) and there's a PPL (city) with the same
        // base name, prefer the city. Also filter out the ADM duplicate to avoid inflating resultCount.
        const searchTerm = parts[firstFoundAt].toLowerCase();
        if (bestRows[0].featureClass === 'A') {
            const pplMatch = bestRows.find(r =>
                r.featureClass === 'P' &&
                r.primaryName.toLowerCase() === searchTerm
            );
            if (pplMatch) {
                // Remove the ADM that the PPL replaces (same base name, just with "County" etc.)
                bestRows = [pplMatch, ...bestRows.filter(r =>
                    r !== pplMatch && !(r.featureClass === 'A' && r.primaryName.toLowerCase().startsWith(searchTerm))
                )];
            }
        }

        // ── Post-process: prefer PCLI (country) over PPL for exact name matches ──
        if (bestRows[0].featureCode !== 'PCLI') {
            const countryMatch = bestRows.find(r =>
                r.featureCode === 'PCLI' &&
                r.primaryName.toLowerCase() === searchTerm
            );
            if (countryMatch) {
                bestRows = [countryMatch, ...bestRows.filter(r => r !== countryMatch)];
            }
        }

        const topRow = bestRows[0];
        const place = this.searchRowToPlace(topRow);
        const droppedParts = firstFoundAt > 0 ? parts.slice(0, firstFoundAt) : [];

        const deduped = this.deduplicatePlaces(bestRows.map(r => this.searchRowToPlace(r)), limit);
        const resultCount = deduped.length;

        const confidence = this.scoreConfidence(
            firstFoundAt, resultCount, place, topRow.population,
            parts, qualifiersDropped,
        );

        return { place, confidence, droppedParts, resultCount };
    }

    private scoreConfidence(
        firstFoundAt: number,
        resultCount: number,
        place: Place,
        population: number,
        parts: string[],
        qualifiersDropped: number,
    ): 'high' | 'medium' | 'low' | 'none' {
        const hasCoords = place.lat != null && place.lng != null;
        if (!hasCoords) return 'low';

        const hasQualifiers = parts.length > 1;
        const firstPartLength = parts[0]?.length ?? 0;

        // Very short inputs without qualifiers are always low confidence
        if (firstPartLength <= 3 && !hasQualifiers) {
            return 'low';
        }

        // Qualifier mismatch (some qualifiers were dropped to find a match)
        if (qualifiersDropped > 0) {
            return 'medium';
        }

        // Parts were dropped from the front (site name extraction)
        if (firstFoundAt >= 2) return 'low';
        if (firstFoundAt === 1) return 'medium';

        // Direct match (firstFoundAt === 0)
        if (hasQualifiers) {
            // With qualifiers: high if unambiguous or large city
            if (resultCount === 1 || population >= 100000) return 'high';
            return 'medium';
        }

        // No qualifiers: confidence depends on population (larger = more likely correct)
        if (population >= 500000) return 'high';
        if (population >= 50000) return 'medium';
        return 'low';
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

    /**
     * Reverse geocode: find the nearest place to the given coordinates.
     * Returns null if no match or no DB available. Cached by rounded coords.
     */
    public async reverseGeocode(lat: number, lng: number): Promise<Place | null> {
        if (!this.geonamesDb) return null;

        await this.ensureCacheLoaded();

        // v3: population-weighted distance — bump version when reverse query logic changes
        const key = `reverse:v3:${lat.toFixed(3)},${lng.toFixed(3)}`;
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }

        const row = this.geonamesDb.reverseGeocode(lat, lng);
        if (!row) return null;

        const place = this.reverseRowToPlace(row);
        this.cache.set(key, place);
        await this.persistCache();
        return place;
    }

    // ─── Private ────────────────────────────────────────────────────────────

    private reverseRowToPlace(row: { primaryName: string; lat: number; lng: number; countryCode: string | null; admin1Name?: string | null; admin2Name?: string | null }): Place {
        const place: Place = {
            name: row.primaryName,
            lat: row.lat,
            lng: row.lng,
        };
        if (row.countryCode) place.countryCode = row.countryCode;
        if (row.admin1Name) place.admin1Name = row.admin1Name;
        if (row.admin2Name) place.admin2Name = row.admin2Name;
        place.resolvedAt = new Date().toISOString();
        return place;
    }

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
    private searchRowToPlace(row: { primaryName: string; lat: number; lng: number; countryCode: string | null; featureCode: string; admin1Name?: string | null; admin2Name?: string | null; matchedName: string; sourceType: string }): Place {
        const place: Place = { name: row.matchedName };

        place.lat = row.lat;
        place.lng = row.lng;

        // Suppress fields that would redundantly echo the place itself
        const isAdm1 = row.featureCode?.startsWith('ADM1');
        const isAdm2 = row.featureCode?.startsWith('ADM2');
        const isCountry = row.featureCode?.startsWith('PCL');

        // Suppress countryCode for country-level results ("United States, US" → "United States")
        if (row.countryCode && !isCountry) {
            place.countryCode = row.countryCode;
        }

        if (row.admin1Name && !isAdm1) {
            place.admin1Name = row.admin1Name;
        }

        if (row.admin2Name && !isAdm2) {
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
