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
            geonameid INTEGER NOT NULL,
            name TEXT NOT NULL,
            is_historic INTEGER DEFAULT 0
        );
        CREATE INDEX idx_altnames_geonameid ON alternate_names(geonameid);

        CREATE TABLE admin1_names (
            country_code TEXT NOT NULL,
            admin1_code TEXT NOT NULL,
            name TEXT NOT NULL,
            geonameid INTEGER NOT NULL,
            PRIMARY KEY (country_code, admin1_code)
        );

        CREATE TABLE admin2_names (
            country_code TEXT NOT NULL,
            admin1_code TEXT NOT NULL,
            admin2_code TEXT NOT NULL,
            name TEXT NOT NULL,
            geonameid INTEGER NOT NULL,
            PRIMARY KEY (country_code, admin1_code, admin2_code)
        );

        CREATE VIRTUAL TABLE names_fts USING fts5(
            name,
            tokenize = 'unicode61 remove_diacritics 2',
            content='',
            columnsize=0
        );

        CREATE TABLE fts_map (
            rowid INTEGER PRIMARY KEY,
            geonameid INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            name TEXT NOT NULL
        );

        CREATE TABLE countries (code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(code, name));

        CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT);

        CREATE INDEX idx_geonames_lat_lng ON geonames(lat, lng);
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
        'INSERT INTO geonames VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertFts = db.prepare(
        'INSERT INTO names_fts (rowid, name) VALUES (?, ?)'
    );
    const insertFtsMap = db.prepare(
        'INSERT INTO fts_map (rowid, geonameid, source_type, name) VALUES (?, ?, ?, ?)'
    );
    const insertAlt = db.prepare(
        'INSERT INTO alternate_names (id, geonameid, name, is_historic) VALUES (?, ?, ?, ?)'
    );
    const insertAdmin1 = db.prepare(
        'INSERT INTO admin1_names VALUES (?, ?, ?, ?)'
    );
    const insertAdmin2 = db.prepare(
        'INSERT INTO admin2_names VALUES (?, ?, ?, ?, ?)'
    );

    let ftsRowId = 0;
    const addFts = (name: string, geonameid: string, sourceType: string) => {
        ftsRowId++;
        insertFts.run(ftsRowId, name);
        insertFtsMap.run(ftsRowId, parseInt(geonameid), sourceType, name);
    };

    // Admin lookup tables
    insertAdmin1.run('GB', 'ENG', 'England', 6269131);
    insertAdmin1.run('US', 'CA', 'California', 5332921);
    insertAdmin1.run('US', 'NY', 'New York', 5128638);
    insertAdmin1.run('US', 'AR', 'Arkansas', 4099753);
    insertAdmin1.run('US', 'TX', 'Texas', 4736286);
    insertAdmin1.run('CA', '08', 'Ontario', 6093943);
    insertAdmin1.run('FR', 'A8', 'Île-de-France', 2988507);
    insertAdmin1.run('DE', '16', 'Berlin', 2950159);
    insertAdmin1.run('ES', '29', 'Madrid', 3117735);
    insertAdmin1.run('IT', '07', 'Lazio', 3169070);
    insertAdmin1.run('RU', '23', 'Kaliningradskaya Oblast', 554234);

    insertAdmin2.run('US', 'CA', '019', 'Fresno County', 5350000);
    insertAdmin2.run('US', 'CA', '017', 'El Dorado County', 5345659);

    // ADM1/ADM2 also in geonames (so they're searchable)
    insertPlace.run(6269131, 'England', 52.16, -0.70, 'A', 'ADM1', 'GB', 'ENG', null, 0);
    insertPlace.run(5332921, 'California', 37.25, -119.75, 'A', 'ADM1', 'US', 'CA', null, 0);
    insertPlace.run(5128638, 'New York', 43.00, -75.50, 'A', 'ADM1', 'US', 'NY', null, 0);
    insertPlace.run(4099753, 'Arkansas', 34.75, -92.50, 'A', 'ADM1', 'US', 'AR', null, 0);
    insertPlace.run(4736286, 'Texas', 31.25, -99.25, 'A', 'ADM1', 'US', 'TX', null, 0);
    insertPlace.run(5350000, 'Fresno County', 36.76, -119.65, 'A', 'ADM2', 'US', 'CA', '019', 0);
    insertPlace.run(5345659, 'El Dorado County', 38.74, -120.52, 'A', 'ADM2', 'US', 'CA', '017', 0);
    addFts('El Dorado County', '5345659', 'primary');

    // El Dorado, Arkansas (different state — to ensure suffix fallback is needed)
    insertPlace.run(4104048, 'El Dorado', 33.2076, -92.6663, 'P', 'PPL', 'US', 'AR', null, 18259);
    addFts('El Dorado', '4104048', 'primary');

    // London, UK
    insertPlace.run(2643743, 'London', 51.5074, -0.1278, 'P', 'PPLC', 'GB', 'ENG', null, 8982000);
    addFts('London', '2643743', 'primary');

    // London, Ontario (Canada)
    insertPlace.run(6058560, 'London', 42.9834, -81.2330, 'P', 'PPL', 'CA', '08', null, 383822);
    addFts('London', '6058560', 'primary');

    // Kaliningrad (formerly Königsberg)
    insertPlace.run(554234, 'Kaliningrad', 54.7104, 20.4522, 'P', 'PPLA', 'RU', '23', null, 489359);
    addFts('Kaliningrad', '554234', 'primary');
    insertAlt.run(1, 554234, 'Königsberg', 1);
    addFts('Königsberg', '554234', 'historic');

    // Paris
    insertPlace.run(2988507, 'Paris', 48.8566, 2.3522, 'P', 'PPLC', 'FR', 'A8', null, 2161000);
    addFts('Paris', '2988507', 'primary');

    // Paris, Texas
    insertPlace.run(4717560, 'Paris', 33.6609, -95.5555, 'P', 'PPL', 'US', 'TX', null, 25171);
    addFts('Paris', '4717560', 'primary');

    // Berlin
    insertPlace.run(2950159, 'Berlin', 52.5200, 13.4050, 'P', 'PPLC', 'DE', '16', null, 3644826);
    addFts('Berlin', '2950159', 'primary');

    // New York City
    insertPlace.run(5128581, 'New York City', 40.7128, -74.0060, 'P', 'PPL', 'US', 'NY', null, 8336817);
    addFts('New York City', '5128581', 'primary');

    // Grizzly Flats, El Dorado County, CA
    insertPlace.run(5350964, 'Grizzly Flats', 38.6449, -120.5227, 'P', 'PPL', 'US', 'CA', '017', 268);
    addFts('Grizzly Flats', '5350964', 'primary');

    // Marble Mountain — a peak in El Dorado County matching "Mountain" prefix
    insertPlace.run(5370001, 'Marble Mountain', 38.80, -120.30, 'P', 'PPL', 'US', 'CA', '017', 50);
    addFts('Marble Mountain', '5370001', 'primary');

    // Fresno, CA (in Fresno County)
    insertPlace.run(5350937, 'Fresno', 36.7378, -119.7871, 'P', 'PPL', 'US', 'CA', '019', 542107);
    addFts('Fresno', '5350937', 'primary');

    // Fresno, TX (different state)
    insertPlace.run(4690798, 'Fresno', 29.5336, -95.4475, 'P', 'PPL', 'US', 'TX', null, 23000);
    addFts('Fresno', '4690798', 'primary');

    // Madrid
    insertPlace.run(3117735, 'Madrid', 40.4168, -3.7038, 'P', 'PPLC', 'ES', '29', null, 3223334);
    addFts('Madrid', '3117735', 'primary');

    // Rome
    insertPlace.run(3169070, 'Rome', 41.9028, 12.4964, 'P', 'PPLC', 'IT', '07', null, 2872800);
    addFts('Rome', '3169070', 'primary');

    // ─── Italian admin regions (for qualifier-dropping tests) ───
    // ADM1: Toscana
    insertAdmin1.run('IT', '16', 'Toscana', 3165361);
    insertPlace.run(3165361, 'Toscana', 43.35, 11.02, 'A', 'ADM1', 'IT', '16', null, 0);
    addFts('Toscana', '3165361', 'primary');
    // ADM2: Provincia di Lucca
    insertAdmin2.run('IT', '16', 'LU', 'Provincia di Lucca', 3174530);
    insertPlace.run(3174530, 'Provincia di Lucca', 44.00, 10.50, 'A', 'ADM2', 'IT', '16', 'LU', 0);
    addFts('Provincia di Lucca', '3174530', 'primary');
    insertAlt.run(10, 3174530, 'Lucca', 0);
    addFts('Lucca', '3174530', 'alternate');
    // ADM3: Camaiore — kept in geonames but not in any lookup table (no ADM3 support)
    insertPlace.run(3180720, 'Camaiore', 43.94, 10.30, 'A', 'ADM3', 'IT', '16', 'LU', 0);
    addFts('Camaiore', '3180720', 'primary');
    // Acquaviva — tiny village in Camaiore, Provincia di Lucca
    insertPlace.run(8974018, 'Acquaviva', 43.93, 10.33, 'P', 'PPL', 'IT', '16', 'LU', 23);
    addFts('Acquaviva', '8974018', 'primary');

    // Chicopee, MA (for church name extraction tests)
    insertAdmin1.run('US', 'MA', 'Massachusetts', 6254926);
    insertPlace.run(4932879, 'Chicopee', 42.1487, -72.6079, 'P', 'PPL', 'US', 'MA', null, 55298);
    addFts('Chicopee', '4932879', 'primary');

    // Belfast (for street address extraction tests)
    insertAdmin1.run('GB', 'NIR', 'Northern Ireland', 2641364);
    insertPlace.run(2655984, 'Belfast', 54.5973, -5.9301, 'P', 'PPL', 'GB', 'NIR', null, 274770);
    addFts('Belfast', '2655984', 'primary');

    // ── Additional test data for batch geocoding confidence scoring ──

    // US country (PCLI)
    insertCountry.run('US', 'United States of America');
    insertPlace.run(6252001, 'United States', 39.76, -98.50, 'A', 'PCLI', 'US', null, null, 331000000);
    addFts('United States', '6252001', 'primary');

    // India country (PCLI)
    insertCountry.run('IN', 'India');
    insertPlace.run(1269750, 'India', 22.00, 79.00, 'A', 'PCLI', 'IN', null, null, 1380000000);
    addFts('India', '1269750', 'primary');

    // Indianapolis (to test India vs Indianapolis ranking)
    insertAdmin1.run('US', 'IN', 'Indiana', 4921868);
    insertPlace.run(4259418, 'Indianapolis', 39.7684, -86.1581, 'P', 'PPL', 'US', 'IN', null, 887642);
    addFts('Indianapolis', '4259418', 'primary');

    // Virginia (for VA state abbreviation test)
    insertAdmin1.run('US', 'VA', 'Virginia', 6254928);
    insertPlace.run(6254928, 'Virginia', 37.43, -78.66, 'A', 'ADM1', 'US', 'VA', null, 0);
    addFts('Virginia', '6254928', 'primary');

    // Missouri (for MO state abbreviation test)
    insertAdmin1.run('US', 'MO', 'Missouri', 4398678);
    insertPlace.run(4398678, 'Missouri', 38.57, -92.60, 'A', 'ADM1', 'US', 'MO', null, 0);
    addFts('Missouri', '4398678', 'primary');

    // Merced city (PPL) — to test PPL vs ADM2 preference
    insertAdmin2.run('US', 'CA', '047', 'Merced County', 5373965);
    insertPlace.run(5373327, 'Merced', 37.3022, -120.4830, 'P', 'PPL', 'US', 'CA', '047', 83893);
    addFts('Merced', '5373327', 'primary');
    // Merced County (ADM2) — higher population
    insertPlace.run(5373965, 'Merced County', 37.19, -120.72, 'A', 'ADM2', 'US', 'CA', '047', 277680);
    addFts('Merced County', '5373965', 'primary');

    // Pine Grove (in Amador County, CA) — to test qualifier matching
    insertAdmin2.run('US', 'CA', '005', 'Amador County', 5322745);
    insertPlace.run(5384802, 'Pine Grove', 38.4163, -120.6582, 'P', 'PPL', 'US', 'CA', '005', 585);
    addFts('Pine Grove', '5384802', 'primary');
    insertPlace.run(5322745, 'Amador County', 38.45, -120.65, 'A', 'ADM2', 'US', 'CA', '005', 40474);
    addFts('Amador County', '5322745', 'primary');

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

    it('overly-specific string skips unrecognized prefix and finds real place', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Mountain, Fresno, CA, United States', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        // "Mountain" finds nothing (no place starting with "Mountain" in Fresno/CA/US),
        // so "Fresno" is found at i=1
        expect(results[0].name).toBe('Fresno');
    });

    it('overly-specific string skips multiple invalid prefixes', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Farm, Rural Area, Fresno, CA', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Fresno');
    });

    it('overly-specific string finds locality, not noise from first part', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        // "Mountain" is an overly-specific genealogy descriptor — should not produce
        // noise results. "Grizzly Flats" should be the primary result.
        const results = await svc.search('Mountain, Grizzly Flats, El Dorado, California, USA', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Grizzly Flats');
        // Should NOT contain unrelated "Mountain*" places
        expect(results.every(r => !r.name!.startsWith('Mountain'))).toBe(true);
    });

    it('search skips short parts (≤3 chars) as place names to avoid slow FTS queries', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        // "CA" is a state code, not a place name — should not be searched as i>0
        const results = await svc.search('Fresno, CA, United States', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Fresno');
        expect(results[0].admin1Name).toBe('California');
        // Should NOT contain results from searching "CA" as a place name
        // (e.g. "Camaiore" matching "CA"* prefix)
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('search drops unrecognized qualifiers (ADM3 commune) to find the place', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const results = await svc.search('Acquaviva, Camaiore, Lucca, Italy', 5);

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].name).toBe('Acquaviva');
        expect(results[0].countryCode).toBe('IT');
    });

    // ── Reverse geocoding ──────────────────────────────────────────────

    it('reverseGeocode returns Place with name, coords, countryCode, admin1Name', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.reverseGeocode(51.51, -0.13);

        expect(result).not.toBeNull();
        expect(result!.name).toBe('London');
        expect(result!.lat).toBeCloseTo(51.5074, 3);
        expect(result!.lng).toBeCloseTo(-0.1278, 3);
        expect(result!.countryCode).toBe('GB');
        expect(result!.admin1Name).toBe('England');
    });

    it('reverseGeocode returns null for ocean coordinates', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.reverseGeocode(0, 0);

        expect(result).toBeNull();
    });

    it('reverseGeocode cache hit on second call with same rounded coords', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const r1 = await svc.reverseGeocode(51.5074, -0.1278);
        const r2 = await svc.reverseGeocode(51.5075, -0.1279); // rounds to same key at 3dp

        expect(r1).not.toBeNull();
        expect(r2).not.toBeNull();
        expect(r1!.name).toBe(r2!.name);
    });

    it('reverseGeocode with missing DB returns null gracefully', async () => {
        const svc = new GeocodingService(dataDir, { dbPath: '/nonexistent/geonames.db' });
        const result = await svc.reverseGeocode(51.5074, -0.1278);

        expect(result).toBeNull();
    });

    it('reverseGeocode sets resolvedAt', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.reverseGeocode(51.5074, -0.1278);

        expect(result).not.toBeNull();
        expect(result!.resolvedAt).toBeDefined();
        expect(new Date(result!.resolvedAt!).toISOString()).toBe(result!.resolvedAt);
    });

    // ── searchWithMetadata ────────────────────────────────────────────

    it('searchWithMetadata: direct match with qualifiers is high confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Fresno, California, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Fresno');
        expect(result.confidence).toBe('high');
        expect(result.droppedParts).toEqual([]);
        expect(result.resultCount).toBe(1);
    });

    it('searchWithMetadata: dropped prefix returns medium confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Mountain, Grizzly Flats, El Dorado, California, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Grizzly Flats');
        expect(result.confidence).toBe('medium');
        expect(result.droppedParts).toEqual(['Mountain']);
    });

    it('searchWithMetadata: church name extracted as dropped part', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Nativity Of The Blessed Virgin Mary Church, Chicopee, MA, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Chicopee');
        expect(result.confidence).toBe('medium');
        expect(result.droppedParts).toEqual(['Nativity Of The Blessed Virgin Mary Church']);
    });

    it('searchWithMetadata: street address extracted as dropped part', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('14 BROWNS ROW, Belfast, Northern Ireland');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Belfast');
        expect(result.confidence).toBe('medium');
        expect(result.droppedParts).toEqual(['14 BROWNS ROW']);
    });

    it('searchWithMetadata: no match returns none confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Zxqvbjk, Nowhere');

        expect(result.place).toBeNull();
        expect(result.confidence).toBe('none');
    });

    it('searchWithMetadata: missing DB returns none confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath: '/nonexistent/geonames.db' });
        const result = await svc.searchWithMetadata('London');

        expect(result.place).toBeNull();
        expect(result.confidence).toBe('none');
    });

    it('searchWithMetadata: leading comma filters empty part', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata(', Fresno, California');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Fresno');
        expect(result.droppedParts).toEqual([]);
    });

    it('searchWithMetadata: large city without qualifiers is high', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('London');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('London');
        expect(result.confidence).toBe('high');
    });

    // ── PPL vs ADM preference ──

    it('searchWithMetadata: prefers city over county when names overlap', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Merced, California, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Merced');
        expect(result.place!.admin2Name).toBe('Merced County');
        expect(result.confidence).toBe('high');
    });

    it('searchWithMetadata: city without qualifiers is medium when pop < 500K', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Merced');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Merced');
        expect(result.confidence).toBe('medium');
    });

    // ── State abbreviation handling ──

    it('searchWithMetadata: "VA" resolves to Virginia with low confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('VA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Virginia');
        expect(result.confidence).toBe('low');
    });

    it('searchWithMetadata: "VA, USA" resolves to Virginia with medium confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('VA, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Virginia');
        expect(result.confidence).toBe('medium');
    });

    it('searchWithMetadata: ",, MO" resolves to Missouri with low confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata(',, MO');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Missouri');
        expect(result.confidence).toBe('low');
    });

    // ── Country name handling ──

    it('searchWithMetadata: "India" resolves to India country, not Indianapolis', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('India');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('India');
        expect(result.confidence).toBe('high');
    });

    it('searchWithMetadata: "United States" has no redundant country code', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('United States');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('United States');
        expect(result.place!.countryCode).toBeUndefined();
        expect(result.confidence).toBe('high');
    });

    // ── Short/ambiguous input ──

    it('searchWithMetadata: very short input without qualifiers is low confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Del');

        if (result.place) {
            expect(result.confidence).toBe('low');
        } else {
            expect(result.confidence).toBe('none');
        }
    });

    // ── Qualifier mismatch detection ──

    it('searchWithMetadata: qualifier mismatch lowers confidence to low', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        // Fresno is not in Merced County — admin hierarchy mismatch → low
        const result = await svc.searchWithMetadata('Fresno, Merced, California');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Fresno');
        expect(result.confidence).toBe('low');
    });

    // ── Bidirectional qualifier matching ──

    it('searchWithMetadata: "United States of America" qualifier matches', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Pine Grove, Amador County, California, United States of America');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Pine Grove');
        expect(result.confidence).toBe('high');
    });

    it('searchWithMetadata: "Pine Grove, California, USA" is high confidence', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Pine Grove, California, USA');

        expect(result.place).not.toBeNull();
        expect(result.place!.name).toBe('Pine Grove');
        expect(result.confidence).toBe('high');
    });

    it('searchWithMetadata: large city with multiple results is still high', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('Paris');

        expect(result.place).not.toBeNull();
        expect(result.confidence).toBe('high');
    });

    it('searchWithMetadata: small ambiguous city without qualifiers is low', async () => {
        const svc = new GeocodingService(dataDir, { dbPath });
        const result = await svc.searchWithMetadata('El Dorado');

        expect(result.place).not.toBeNull();
        expect(result.confidence).toBe('low');
    });
});
