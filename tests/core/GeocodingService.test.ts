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

        CREATE TABLE countries (code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(code, name));

        CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT);
    `);

    // Insert countries
    const insertCountry = db.prepare('INSERT INTO countries VALUES (?, ?)');
    insertCountry.run('GB', 'United Kingdom');
    insertCountry.run('GB', 'Great Britain');
    insertCountry.run('US', 'United States');
    insertCountry.run('CA', 'Canada');
    insertCountry.run('FR', 'France');
    insertCountry.run('DE', 'Germany');
    insertCountry.run('ES', 'Spain');
    insertCountry.run('IT', 'Italy');
    insertCountry.run('RU', 'Russia');

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
    insertPlace.run(4099753, 'Arkansas', 'Arkansas', 34.75, -92.50, 'A', 'ADM1', 'US', 'AR', null, 0);
    insertPlace.run(4736286, 'Texas', 'Texas', 31.25, -99.25, 'A', 'ADM1', 'US', 'TX', null, 0);

    // ADM2 records (counties)
    insertPlace.run(5350000, 'Fresno County', 'Fresno County', 36.76, -119.65, 'A', 'ADM2', 'US', 'CA', '019', 0);
    insertPlace.run(5345659, 'El Dorado County', 'El Dorado County', 38.74, -120.52, 'A', 'ADM2', 'US', 'CA', '017', 0);
    insertFts.run('El Dorado County', '5345659', 'primary');

    // El Dorado, Arkansas (different state — to ensure suffix fallback is needed)
    insertPlace.run(4104048, 'El Dorado', 'El Dorado', 33.2076, -92.6663, 'P', 'PPL', 'US', 'AR', null, 18259);
    insertFts.run('El Dorado', '4104048', 'primary');

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

    // Grizzly Flats, El Dorado County, CA
    insertPlace.run(5350964, 'Grizzly Flats', 'Grizzly Flats', 38.6449, -120.5227, 'P', 'PPL', 'US', 'CA', '017', 268);
    insertFts.run('Grizzly Flats', '5350964', 'primary');

    // Marble Mountain — a peak in El Dorado County matching "Mountain" prefix
    insertPlace.run(5370001, 'Marble Mountain', 'Marble Mountain', 38.80, -120.30, 'P', 'PPL', 'US', 'CA', '017', 50);
    insertFts.run('Marble Mountain', '5370001', 'primary');

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

    // ─── Italian admin regions (for qualifier-dropping tests) ───
    // ADM1: Toscana
    insertPlace.run(3165361, 'Toscana', 'Toscana', 43.35, 11.02, 'A', 'ADM1', 'IT', '16', null, 0);
    insertFts.run('Toscana', '3165361', 'primary');
    // ADM2: Provincia di Lucca
    insertPlace.run(3174530, 'Provincia di Lucca', 'Provincia di Lucca', 44.00, 10.50, 'A', 'ADM2', 'IT', '16', 'LU', 0);
    insertFts.run('Provincia di Lucca', '3174530', 'primary');
    insertAlt.run(10, 3174530, 'Lucca', 'it', 0, 0);
    insertFts.run('Lucca', '3174530', 'alternate');
    // ADM3: Camaiore (not stored in admin columns — only a geonames entry)
    insertPlace.run(3180720, 'Camaiore', 'Camaiore', 43.94, 10.30, 'A', 'ADM3', 'IT', '16', 'LU', 0);
    insertFts.run('Camaiore', '3180720', 'primary');
    // Acquaviva — tiny village in Camaiore, Provincia di Lucca
    insertPlace.run(8974018, 'Acquaviva', 'Acquaviva', 43.93, 10.33, 'P', 'PPL', 'IT', '16', 'LU', 23);
    insertFts.run('Acquaviva', '8974018', 'primary');

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

        expect(results.length).toBeGreaterThanOrEqual(1);
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

    it('search "El Dorado, California, US" finds El Dorado County via suffix fallback', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('El Dorado, California, US', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some(r => r.name === 'El Dorado County')).toBe(true);
    });

    it('search "Fresno, USA" matches country code prefix', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno, USA', 5);

        expect(results.length).toBe(2);
        expect(results.every(r => r.countryCode === 'US')).toBe(true);
    });

    it('search "London, United Kingdom" resolves country name', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('London, United Kingdom', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('GB');
    });

    it('search "Berlin, Germany" resolves country name', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Berlin, Germany', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('DE');
    });

    it('search "Fresno, CA, United States" resolves admin1 + country name', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Fresno, CA, United States', 5);

        expect(results.length).toBe(1);
        expect(results[0].admin1Name).toBe('California');
        expect(results[0].countryCode).toBe('US');
    });

    it('search "London, Great Britain" resolves country alias', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('London, Great Britain', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('GB');
    });

    it('search "Paris, France" resolves country name', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Paris, France', 5);

        expect(results.length).toBe(1);
        expect(results[0].countryCode).toBe('FR');
    });

    it('overly-specific string includes results from multiple part interpretations', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Mountain, Fresno, CA, United States', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        // Fresno should appear (either as first result if "Mountain" has no match,
        // or alongside "Marble Mountain" if it does)
        expect(results.some(r => r.name === 'Fresno')).toBe(true);
    });

    it('overly-specific string skips multiple invalid prefixes', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Farm, Rural Area, Fresno, CA', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Fresno');
    });

    it('search returns results from multiple part interpretations', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        // "Mountain" matches "Marble Mountain" at i=0, "Grizzly Flats" matches at i=1
        const results = await svc.search('Mountain, Grizzly Flats, El Dorado, California, USA', 5);

        expect(results.length).toBeGreaterThanOrEqual(2);
        const names = results.map(r => r.name);
        expect(names).toContain('Marble Mountain');
        expect(names).toContain('Grizzly Flats');
    });

    it('search drops unrecognized qualifiers (ADM3 commune) to find the place', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Acquaviva, Camaiore, Lucca, Italy', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Acquaviva');
        expect(results[0].countryCode).toBe('IT');
    });
});
