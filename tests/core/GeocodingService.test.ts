import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DatabaseSync } from 'node:sqlite';
import { GeocodingService } from '../../src/core/GeocodingService';

/**
 * Creates a small in-memory GeoNames SQLite database and writes it to disk
 * so GeocodingService can open it by path.
 */
async function createTestGeonamesDb(dbPath: string): Promise<void> {
    const dir = path.dirname(dbPath);
    await fs.mkdir(dir, { recursive: true });

    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE geonames (
            geonameid INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            asciiname TEXT,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            feature_class TEXT NOT NULL,
            feature_code TEXT NOT NULL,
            country_code TEXT,
            admin1 TEXT,
            admin2 TEXT,
            population INTEGER DEFAULT 0
        );

        CREATE TABLE alternate_names (
            id INTEGER PRIMARY KEY,
            geonameid INTEGER NOT NULL REFERENCES geonames(geonameid),
            name TEXT NOT NULL,
            lang TEXT,
            is_historic INTEGER DEFAULT 0,
            is_preferred INTEGER DEFAULT 0
        );
        CREATE INDEX idx_altnames_geonameid ON alternate_names(geonameid);
        CREATE INDEX idx_geonames_adm2_lookup ON geonames(country_code, admin1, admin2, feature_code);

        CREATE VIRTUAL TABLE names_fts USING fts5(
            name,
            geonameid UNINDEXED,
            source_type UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT);
    `);

    const insertPlace = db.prepare(
        'INSERT INTO geonames VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertFts = db.prepare(
        'INSERT INTO names_fts (name, geonameid, source_type) VALUES (?, ?, ?)'
    );
    const insertAlt = db.prepare(
        'INSERT INTO alternate_names (id, geonameid, name, lang, is_historic, is_preferred) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // ADM1 records
    insertPlace.run(6269131, 'England', 'England', 52.16, -0.70, 'A', 'ADM1', 'GB', 'ENG', null, 0);
    insertPlace.run(5332921, 'California', 'California', 37.25, -119.75, 'A', 'ADM1', 'US', 'CA', null, 0);
    insertPlace.run(5128638, 'New York', 'New York', 43.00, -75.50, 'A', 'ADM1', 'US', 'NY', null, 0);

    // ADM2 records (counties)
    insertPlace.run(5350000, 'Fresno County', 'Fresno County', 36.76, -119.65, 'A', 'ADM2', 'US', 'CA', '019', 0);

    // London, UK
    insertPlace.run(2643743, 'London', 'London', 51.5074, -0.1278, 'P', 'PPLC', 'GB', 'ENG', null, 8982000);
    insertFts.run('London', '2643743', 'primary');

    // London, Ontario (Canada)
    insertPlace.run(6058560, 'London', 'London', 42.9834, -81.2330, 'P', 'PPL', 'CA', '08', null, 383822);
    insertFts.run('London', '6058560', 'primary');

    // Kaliningrad (formerly Königsberg)
    insertPlace.run(554234, 'Kaliningrad', 'Kaliningrad', 54.7104, 20.4522, 'P', 'PPLA', 'RU', '23', null, 489359);
    insertFts.run('Kaliningrad', '554234', 'primary');
    insertAlt.run(1, 554234, 'Königsberg', 'de', 1, 0);
    insertFts.run('Königsberg', '554234', 'historic');

    // Paris
    insertPlace.run(2988507, 'Paris', 'Paris', 48.8566, 2.3522, 'P', 'PPLC', 'FR', 'A8', null, 2161000);
    insertFts.run('Paris', '2988507', 'primary');

    // Paris, Texas
    insertPlace.run(4717560, 'Paris', 'Paris', 33.6609, -95.5555, 'P', 'PPL', 'US', 'TX', null, 25171);
    insertFts.run('Paris', '4717560', 'primary');

    // Berlin
    insertPlace.run(2950159, 'Berlin', 'Berlin', 52.5200, 13.4050, 'P', 'PPLC', 'DE', '16', null, 3644826);
    insertFts.run('Berlin', '2950159', 'primary');

    // New York City
    insertPlace.run(5128581, 'New York City', 'New York City', 40.7128, -74.0060, 'P', 'PPL', 'US', 'NY', null, 8336817);
    insertFts.run('New York City', '5128581', 'primary');

    // Fresno, CA (in Fresno County)
    insertPlace.run(5350937, 'Fresno', 'Fresno', 36.7378, -119.7871, 'P', 'PPL', 'US', 'CA', '019', 542107);
    insertFts.run('Fresno', '5350937', 'primary');

    // Fresno, TX (different state)
    insertPlace.run(4690798, 'Fresno', 'Fresno', 29.5336, -95.4475, 'P', 'PPL', 'US', 'TX', null, 23000);
    insertFts.run('Fresno', '4690798', 'primary');

    // Madrid
    insertPlace.run(3117735, 'Madrid', 'Madrid', 40.4168, -3.7038, 'P', 'PPLC', 'ES', '29', null, 3223334);
    insertFts.run('Madrid', '3117735', 'primary');

    // Rome
    insertPlace.run(3169070, 'Rome', 'Rome', 41.9028, 12.4964, 'P', 'PPLC', 'IT', '07', null, 2872800);
    insertFts.run('Rome', '3169070', 'primary');

    db.close();
}

describe('GeocodingService', () => {
    let dataDir: string;
    let dbPath: string;

    beforeEach(async () => {
        dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'geo-test-'));
        await fs.mkdir(path.join(dataDir, '_meta'), { recursive: true });
        dbPath = path.join(dataDir, 'geonames.db');
        await createTestGeonamesDb(dbPath);
    });

    afterEach(async () => {
        await fs.rm(dataDir, { recursive: true, force: true });
    });

    it('resolve known city returns lat/lng/countryCode', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.resolve('London');

        expect(result.name).toBe('London');
        expect(result.lat).toBeCloseTo(51.5074, 3);
        expect(result.lng).toBeCloseTo(-0.1278, 3);
        expect(result.countryCode).toBe('GB');
        expect(result.historicalName).toBeUndefined();
    });

    it('resolve unknown place returns { name } fallback', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.resolve('Zxqvbjk');

        expect(result.name).toBe('Zxqvbjk');
        expect(result.lat).toBeUndefined();
        expect(result.lng).toBeUndefined();
    });

    it('missing DB file returns { name } fallback (graceful degradation)', async () => {
        const svc = new GeocodingService(dataDir, { dbPath: '/nonexistent/geonames.db' });
        const result = await svc.resolve('London');

        expect(result.name).toBe('London');
        expect(result.lat).toBeUndefined();
    });

    it('cache hit skips DB query (second resolve uses cache)', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const r1 = await svc.resolve('London');
        const r2 = await svc.resolve('London');

        // Both return same result
        expect(r1.lat).toEqual(r2.lat);
        expect(r1.lng).toEqual(r2.lng);
    });

    it('case-insensitive cache: "London" and "london" share entry', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const r1 = await svc.resolve('London');
        const r2 = await svc.resolve('london');

        expect(r1.name).toBe(r2.name);
    });

    it('disk persistence — new instance loads cache without DB access', async () => {
        // First instance populates disk cache
        const svc1 = new GeocodingService(dataDir, { dbPath });
        await svc1.resolve('London');

        // Second instance with bad DB path — should load from disk cache
        const svc2 = new GeocodingService(dataDir, { dbPath: '/nonexistent/geonames.db' });
        const result = await svc2.resolve('London');

        expect(result.lat).toBeCloseTo(51.5074, 3);
    });

    it('historicalName set when resolved name differs from input', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.resolve('Königsberg');

        expect(result.historicalName).toBe('Königsberg');
        expect(result.name).toBe('Kaliningrad');
    });

    it('search() returns max limit results', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('London', 5);

        expect(results.length).toBeLessThanOrEqual(5);
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('search() with missing DB returns empty array', async () => {
        const svc = new GeocodingService(dataDir, { dbPath: '/nonexistent/geonames.db' });
        const results = await svc.search('London');

        expect(results).toEqual([]);
    });

    it('resolvedAt is set on resolved places', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.resolve('London');

        expect(result.resolvedAt).toBeDefined();
        // Should be a valid ISO date
        expect(new Date(result.resolvedAt!).toISOString()).toBe(result.resolvedAt);
    });

    // ── Comma-qualified search ──────────────────────────────────────────

    it('search "Fresno, California" filters to Fresno in CA', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno, California', 5);

        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Fresno');
        expect(results[0].admin1Name).toBe('California');
    });

    it('search "Fresno, CA" matches admin1 code', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno, CA', 5);

        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Fresno');
        expect(results[0].admin1Name).toBe('California');
    });

    it('search "Fresno, Fresno County, CA" filters by admin2 and admin1', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno, Fresno County, CA', 5);

        expect(results.length).toBe(1);
        expect(results[0].name).toBe('Fresno');
        expect(results[0].admin2Name).toBe('Fresno County');
        expect(results[0].admin1Name).toBe('California');
    });

    it('search "Paris, FR" filters to Paris, France', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Paris, FR', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('FR');
    });

    it('search "Paris, US" filters to Paris, Texas', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Paris, US', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('US');
    });

    it('search "London, GB" filters to London, UK', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('London, GB', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('GB');
    });

    it('plain search without commas still works', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno', 5);

        // Should return both Fresno CA and Fresno TX
        expect(results.length).toBe(2);
    });
});
