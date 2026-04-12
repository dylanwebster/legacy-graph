import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';

export interface GeonamesRow {
    geonameid: number;
    primaryName: string;
    lat: number;
    lng: number;
    countryCode: string | null;
    featureClass: string;
    featureCode: string;
    population: number;
    matchedName: string;
    sourceType: string; // 'primary' | 'alternate' | 'historic'
    admin1Code: string | null;
    admin1Name: string | null;
    admin2Name: string | null;
}

/**
 * Read-only SQLite wrapper for the GeoNames FTS5 database.
 * Provides searchByName (type-ahead) and resolveByName (best single match).
 */
export class GeonamesDb {
    private readonly db: DatabaseSync;
    private readonly searchStmt: ReturnType<DatabaseSync['prepare']>;
    private readonly resolveStmt: ReturnType<DatabaseSync['prepare']>;
    private readonly hasCountries: boolean;
    private readonly baseSql: string;

    private readonly reverseStmt: ReturnType<DatabaseSync['prepare']>;

    private constructor(db: DatabaseSync) {
        this.db = db;

        // Detect whether countries table exists (for country name matching in qualifiers)
        this.hasCountries = this.tableExists(db, 'countries');

        this.baseSql = `
            SELECT
                g.geonameid,
                g.name AS primary_name,
                g.lat,
                g.lng,
                g.country_code,
                g.feature_class,
                g.feature_code,
                g.population,
                fm.name AS matched_name,
                fm.source_type,
                g.admin1 AS admin1_code,
                a.name AS admin1_name,
                a2.name AS admin2_name
            FROM names_fts f
            JOIN fts_map fm ON fm.rowid = f.rowid
            JOIN geonames g ON g.geonameid = fm.geonameid
            LEFT JOIN admin1_names a ON a.country_code = g.country_code
                AND a.admin1_code = g.admin1
            LEFT JOIN admin2_names a2 ON a2.country_code = g.country_code
                AND a2.admin1_code = g.admin1
                AND a2.admin2_code = g.admin2
        `;

        const sql = this.baseSql + `
            WHERE names_fts MATCH ?
            ORDER BY
                (CASE
                    WHEN g.population >= 100000 THEN 0
                    WHEN LOWER(fm.name) = LOWER(?) AND g.feature_class = 'A' THEN 0
                    WHEN LOWER(fm.name) = LOWER(?) THEN 1
                    ELSE 2
                END),
                (CASE WHEN fm.source_type = 'primary' THEN 0 ELSE 1 END),
                (CASE
                    WHEN g.feature_class = 'P' THEN 0
                    WHEN g.feature_class = 'A' AND LOWER(fm.name) = LOWER(?) THEN 0
                    WHEN g.feature_class = 'A' THEN 1
                    ELSE 2
                END),
                -1 * CASE WHEN g.population > 0 THEN g.population ELSE 0 END,
                rank
            LIMIT ?
        `;

        this.searchStmt = db.prepare(sql);
        this.resolveStmt = db.prepare(sql);

        const reverseSql = `
            SELECT
                g.geonameid,
                g.name AS primary_name,
                g.lat,
                g.lng,
                g.country_code,
                g.feature_class,
                g.feature_code,
                g.population,
                g.name AS matched_name,
                'primary' AS source_type,
                g.admin1 AS admin1_code,
                a.name AS admin1_name,
                a2.name AS admin2_name
            FROM geonames g
            LEFT JOIN admin1_names a ON a.country_code = g.country_code
                AND a.admin1_code = g.admin1
            LEFT JOIN admin2_names a2 ON a2.country_code = g.country_code
                AND a2.admin1_code = g.admin1
                AND a2.admin2_code = g.admin2
            WHERE g.lat BETWEEN ? AND ?
              AND g.lng BETWEEN ? AND ?
              AND g.feature_code NOT IN ('PPLH', 'PPLQ', 'PPLW')
            ORDER BY
                ((g.lat - ?) * (g.lat - ?) + (g.lng - ?) * (g.lng - ?) * ? * ?) /
                (CASE
                    WHEN g.population >= 10000 THEN 2.0
                    WHEN g.population >= 1000  THEN 1.5
                    WHEN g.population >= 100   THEN 1.2
                    ELSE 1.0
                END),
                (CASE WHEN g.feature_class = 'P' THEN 0 ELSE 1 END),
                -1 * CASE WHEN g.population > 0 THEN g.population ELSE 0 END
            LIMIT 1
        `;
        this.reverseStmt = db.prepare(reverseSql);
    }

    private tableExists(db: DatabaseSync, table: string): boolean {
        try {
            const rows = db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
            ).all(table) as any[];
            return rows.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Open a GeoNames database from a file path. Returns null if file doesn't exist
     * or the database schema is incompatible (missing required tables like fts_map).
     */
    static fromFile(dbPath: string): GeonamesDb | null {
        if (!fs.existsSync(dbPath)) {
            return null;
        }
        try {
            const db = new DatabaseSync(dbPath, { readOnly: true });
            return new GeonamesDb(db);
        } catch {
            // Schema incompatible (e.g. missing fts_map table from v1 DB)
            return null;
        }
    }

    /**
     * Create a GeonamesDb from an already-open DatabaseSync connection.
     * Used for testing with in-memory databases.
     */
    static fromConnection(db: DatabaseSync): GeonamesDb {
        return new GeonamesDb(db);
    }

    /**
     * Search for places by name. Returns up to `limit` results ranked by relevance.
     * Supports prefix matching and diacritics-insensitive search.
     */
    searchByName(query: string, limit: number): GeonamesRow[] {
        const ftsQuery = this.buildFtsQuery(query);
        if (!ftsQuery) return [];

        try {
            // Fetch extra rows to account for duplicates from alternate names
            const rows = this.searchStmt.all(ftsQuery, query, query, query, limit * 4) as any[];
            // Deduplicate by geonameid, keeping the first (best-ranked) row
            const seen = new Set<number>();
            const deduped: GeonamesRow[] = [];
            for (const row of rows) {
                const id = row.geonameid;
                if (seen.has(id)) continue;
                seen.add(id);
                deduped.push(this.rowToGeonamesRow(row));
                if (deduped.length >= limit) break;
            }
            return deduped;
        } catch {
            return [];
        }
    }

    /**
     * Search with SQL-level region qualifiers. Each qualifier is matched against
     * countryCode, admin1 code, admin1 name, or admin2 name directly in SQL,
     * so results are filtered before the LIMIT is applied.
     */
    searchFiltered(query: string, qualifiers: string[], limit: number): GeonamesRow[] {
        const ftsQuery = this.buildFtsQuery(query);
        if (!ftsQuery) return [];

        // Build a WHERE clause per qualifier. Each qualifier is matched against
        // country code, country name (via countries table), admin1 code, admin1 name, or admin2 name.
        // All matching is done in SQL so partial typing works naturally.
        const qualifierClauses: string[] = [];
        const params: (string | number)[] = [ftsQuery];

        for (const q of qualifiers) {
            const ql = q.toLowerCase();

            const conditions = [
                'LOWER(g.country_code) = ?',
                '? LIKE LOWER(g.country_code) || \'%\'',
                'LOWER(g.admin1) = ?',
                // Admin1: prefix matching in both directions so "United States of America"
                // matches "United States" and "Calif" matches "California".
                // Reverse direction requires min length 4 on the name to avoid short aliases.
                'LOWER(a.name) LIKE ? || \'%\'',
                '(LENGTH(a.name) >= 4 AND ? LIKE LOWER(a.name) || \'%\')',
                // Match qualifier against alternate names for the admin1 region
                // (e.g. "Tuscany" → "Toscana" via English alternate name).
                // Require qualifier length >= 4 for prefix matching to avoid "CA" matching "Carolina del Sur"
                'EXISTS (SELECT 1 FROM alternate_names an1 WHERE an1.geonameid = a.geonameid AND (LOWER(an1.name) = ? OR (LENGTH(?) >= 4 AND (LOWER(an1.name) LIKE ? || \'%\' OR (LENGTH(an1.name) >= 4 AND ? LIKE LOWER(an1.name) || \'%\')))))',
                // Admin2 name (substring match for "Provincia di..." patterns)
                'LOWER(a2.name) LIKE \'%\' || ? || \'%\'',
                // Match qualifier against alternate names for the admin2 region
                'EXISTS (SELECT 1 FROM alternate_names an2 WHERE an2.geonameid = a2.geonameid AND LOWER(an2.name) LIKE \'%\' || ? || \'%\')',
            ];
            const condParams = [ql, ql, ql, ql, ql, ql, ql, ql, ql, ql, ql];

            // Match qualifier against country names in the countries table (bidirectional).
            // Reverse direction requires min length 4 on the country name to avoid short
            // aliases like "SA", "SAD" matching unrelated queries.
            if (this.hasCountries) {
                conditions.push(
                    'EXISTS (SELECT 1 FROM countries c WHERE c.code = g.country_code AND (LOWER(c.name) LIKE ? || \'%\' OR (LENGTH(c.name) >= 4 AND ? LIKE LOWER(c.name) || \'%\')))'
                );
                condParams.push(ql, ql);
            }

            qualifierClauses.push(`(${conditions.join(' OR ')})`);
            params.push(...condParams);
        }

        const sql = this.baseSql + `
            WHERE names_fts MATCH ?
            AND ${qualifierClauses.join(' AND ')}
            ORDER BY
                (CASE
                    WHEN g.population >= 100000 THEN 0
                    WHEN LOWER(fm.name) = LOWER(?) AND g.feature_class = 'A' THEN 0
                    WHEN LOWER(fm.name) = LOWER(?) THEN 1
                    ELSE 2
                END),
                (CASE WHEN fm.source_type = 'primary' THEN 0 ELSE 1 END),
                (CASE
                    WHEN g.feature_class = 'P' THEN 0
                    WHEN g.feature_class = 'A' AND LOWER(fm.name) = LOWER(?) THEN 0
                    WHEN g.feature_class = 'A' THEN 1
                    ELSE 2
                END),
                -1 * CASE WHEN g.population > 0 THEN g.population ELSE 0 END,
                rank
            LIMIT ?
        `;
        params.push(query); // for relevance tier (ADM exact match)
        params.push(query); // for relevance tier (exact match)
        params.push(query); // for feature_class promotion
        params.push(limit * 4);

        try {
            const rows = this.db.prepare(sql).all(...params) as any[];
            const seen = new Set<number>();
            const deduped: GeonamesRow[] = [];
            for (const row of rows) {
                const id = row.geonameid;
                if (seen.has(id)) continue;
                seen.add(id);
                deduped.push(this.rowToGeonamesRow(row));
                if (deduped.length >= limit) break;
            }
            return deduped;
        } catch {
            return [];
        }
    }

    /**
     * Resolve a place name to the single best match. Returns null if no match.
     */
    resolveByName(name: string): GeonamesRow | null {
        const ftsQuery = this.buildFtsQuery(name);
        if (!ftsQuery) return null;

        try {
            const rows = this.resolveStmt.all(ftsQuery, name, name, name, 1) as any[];
            if (rows.length === 0) return null;
            return this.rowToGeonamesRow(rows[0]);
        } catch {
            return null;
        }
    }

    /**
     * Reverse geocode: find the nearest place to the given coordinates.
     * Uses a bounding box query with cosine-corrected distance sorting.
     * Returns null if no place is found within ~55km.
     */
    reverseGeocode(lat: number, lng: number): GeonamesRow | null {
        const cosLat = Math.cos(lat * Math.PI / 180);

        // Try narrow box first (±0.1° ≈ 11km), then widen (±0.5° ≈ 55km)
        for (const radius of [0.1, 0.5]) {
            try {
                const rows = this.reverseStmt.all(
                    lat - radius, lat + radius,
                    lng - radius, lng + radius,
                    lat, lat, lng, lng, cosLat, cosLat,
                ) as any[];
                if (rows.length > 0) {
                    return this.rowToGeonamesRow(rows[0]);
                }
            } catch {
                return null;
            }
        }

        return null;
    }

    /**
     * Look up an admin1 region by its code (e.g., "VA" → Virginia).
     * US-first: if no countryCode specified, tries US first, then any country.
     */
    lookupAdmin1ByCode(code: string, countryCode?: string): GeonamesRow | null {
        const sql = `
            SELECT g.geonameid, g.name AS primary_name, g.lat, g.lng,
                g.country_code, g.feature_class, g.feature_code, g.population,
                g.name AS matched_name, 'primary' AS source_type,
                g.admin1 AS admin1_code, a.name AS admin1_name, NULL AS admin2_name
            FROM admin1_names a
            JOIN geonames g ON g.geonameid = a.geonameid
            WHERE UPPER(a.admin1_code) = UPPER(?)
            ${countryCode ? 'AND UPPER(a.country_code) = UPPER(?)' : ''}
            ORDER BY g.population DESC
            LIMIT 1
        `;
        try {
            const params: string[] = [code];
            if (countryCode) params.push(countryCode);
            const rows = this.db.prepare(sql).all(...params) as any[];
            return rows.length > 0 ? this.rowToGeonamesRow(rows[0]) : null;
        } catch {
            return null;
        }
    }

    /**
     * Resolve a country name or code to its 2-letter country code.
     * Only queries the small `countries` table (~250 rows), no geonames scan.
     */
    resolveCountryCode(query: string): string | null {
        if (!this.hasCountries) return null;
        const ql = query.toLowerCase().trim();
        if (!ql) return null;

        try {
            const sql = ql.length === 2
                ? `SELECT DISTINCT code FROM countries WHERE LOWER(code) = ? OR LOWER(name) = ? LIMIT 1`
                : `SELECT DISTINCT code FROM countries
                   WHERE LOWER(name) = ?
                      OR (LENGTH(?) >= 4 AND LOWER(name) LIKE ? || '%')
                      OR (LENGTH(?) >= 4 AND LENGTH(name) >= 4 AND ? LIKE LOWER(name) || '%')
                   ORDER BY (CASE WHEN LOWER(name) = ? THEN 0 ELSE 1 END)
                   LIMIT 1`;
            const params = ql.length === 2 ? [ql, ql] : [ql, ql, ql, ql, ql];
            const rows = this.db.prepare(sql).all(...params) as any[];
            return rows.length > 0 ? (rows[0] as any).code : null;
        } catch {
            return null;
        }
    }

    /**
     * Look up a country's PCLI geonames entry by country code.
     * Caches results to avoid repeated full-table scans on geonames.
     */
    private pclCache = new Map<string, GeonamesRow | null>();
    lookupCountryPcl(countryCode: string): GeonamesRow | null {
        const key = countryCode.toUpperCase();
        if (this.pclCache.has(key)) return this.pclCache.get(key)!;

        try {
            const sql = `
                SELECT g.geonameid, g.name AS primary_name, g.lat, g.lng,
                    g.country_code, g.feature_class, g.feature_code, g.population,
                    g.name AS matched_name, 'primary' AS source_type,
                    g.admin1 AS admin1_code, NULL AS admin1_name, NULL AS admin2_name
                FROM geonames g
                WHERE g.country_code = ? AND g.feature_code IN ('PCLI', 'PCL')
                ORDER BY g.population DESC
                LIMIT 1
            `;
            const rows = this.db.prepare(sql).all(key) as any[];
            const result = rows.length > 0 ? this.rowToGeonamesRow(rows[0]) : null;
            this.pclCache.set(key, result);
            return result;
        } catch {
            return null;
        }
    }

    /**
     * Build an FTS5 query string from user input.
     * Escapes special characters and adds prefix matching.
     */
    private buildFtsQuery(input: string): string | null {
        const trimmed = input.trim();
        if (!trimmed) return null;

        // Escape double quotes in input
        const escaped = trimmed.replace(/"/g, '""');
        // Anchored phrase prefix: ^ requires match at start of name,
        // so "Mountain"* matches "Mountain View" but not "Marble Mountain"
        return `^ "${escaped}"*`;
    }

    private rowToGeonamesRow(row: any): GeonamesRow {
        return {
            geonameid: row.geonameid,
            primaryName: row.primary_name,
            lat: row.lat,
            lng: row.lng,
            countryCode: row.country_code ?? null,
            featureClass: row.feature_class,
            featureCode: row.feature_code,
            population: row.population,
            matchedName: row.matched_name,
            sourceType: row.source_type,
            admin1Code: row.admin1_code ?? null,
            admin1Name: row.admin1_name ?? null,
            admin2Name: row.admin2_name ?? null,
        };
    }
}
