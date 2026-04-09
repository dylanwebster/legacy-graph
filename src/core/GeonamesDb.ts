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
    admin1Name: string | null;
}

/**
 * Read-only SQLite wrapper for the GeoNames FTS5 database.
 * Provides searchByName (type-ahead) and resolveByName (best single match).
 */
export class GeonamesDb {
    private readonly db: DatabaseSync;
    private readonly searchStmt: ReturnType<DatabaseSync['prepare']>;
    private readonly resolveStmt: ReturnType<DatabaseSync['prepare']>;

    private constructor(db: DatabaseSync) {
        this.db = db;

        const sql = `
            SELECT
                g.geonameid,
                g.name AS primary_name,
                g.lat,
                g.lng,
                g.country_code,
                g.feature_class,
                g.feature_code,
                g.population,
                f.name AS matched_name,
                f.source_type,
                a.name AS admin1_name
            FROM names_fts f
            JOIN geonames g ON g.geonameid = CAST(f.geonameid AS INTEGER)
            LEFT JOIN geonames a ON a.country_code = g.country_code
                AND a.admin1 = g.admin1
                AND a.feature_code = 'ADM1'
            WHERE names_fts MATCH ?
            ORDER BY
                (CASE WHEN LOWER(f.name) = LOWER(?) THEN 0 ELSE 1 END),
                (CASE WHEN f.source_type = 'primary' THEN 0 ELSE 1 END),
                (CASE WHEN g.feature_class = 'P' THEN 0 WHEN g.feature_class = 'A' THEN 1 ELSE 2 END),
                -1 * CASE WHEN g.population > 0 THEN g.population ELSE 0 END,
                rank
            LIMIT ?
        `;

        this.searchStmt = db.prepare(sql);
        this.resolveStmt = db.prepare(sql);
    }

    /**
     * Open a GeoNames database from a file path. Returns null if file doesn't exist.
     */
    static fromFile(dbPath: string): GeonamesDb | null {
        if (!fs.existsSync(dbPath)) {
            return null;
        }
        const db = new DatabaseSync(dbPath, { readOnly: true });
        return new GeonamesDb(db);
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
            const rows = this.searchStmt.all(ftsQuery, query, limit) as any[];
            return rows.map(this.rowToGeonamesRow);
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
            const rows = this.resolveStmt.all(ftsQuery, name, 1) as any[];
            if (rows.length === 0) return null;
            return this.rowToGeonamesRow(rows[0]);
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
        // Phrase prefix search: "new yor"* matches "New York City"
        return `"${escaped}"*`;
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
            admin1Name: row.admin1_name ?? null,
        };
    }
}
