import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { GeonamesDb } from '../../src/core/GeonamesDb';

/**
 * Helper: creates an in-memory GeoNames database with a small fixture set
 * and returns a GeonamesDb instance backed by it.
 */
function createTestDb(): { db: GeonamesDb; raw: DatabaseSync } {
    const raw = new DatabaseSync(':memory:');

    // Create schema
    raw.exec(`
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
    const insertCountry = raw.prepare('INSERT INTO countries VALUES (?, ?)');
    insertCountry.run('GB', 'United Kingdom');
    insertCountry.run('GB', 'Great Britain');
    insertCountry.run('US', 'United States');
    insertCountry.run('CA', 'Canada');
    insertCountry.run('RU', 'Russia');
    insertCountry.run('SE', 'Sweden');
    insertCountry.run('SK', 'Slovakia');
    insertCountry.run('DE', 'Germany');


    // Insert test places
    const insertPlace = raw.prepare(
        'INSERT INTO geonames VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertFts = raw.prepare(
        'INSERT INTO names_fts (name, geonameid, source_type) VALUES (?, ?, ?)'
    );
    const insertAlt = raw.prepare(
        'INSERT INTO alternate_names (id, geonameid, name, lang, is_historic, is_preferred) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // ADM1 records (for admin1 name JOIN)
    insertPlace.run(6269131, 'England', 'England', 52.16, -0.70, 'A', 'ADM1', 'GB', 'ENG', null, 0);
    insertPlace.run(5332921, 'California', 'California', 37.25, -119.75, 'A', 'ADM1', 'US', 'CA', null, 0);
    insertPlace.run(6093943, 'Ontario', 'Ontario', 50.00, -86.00, 'A', 'ADM1', 'CA', '08', null, 0);
    insertPlace.run(5128638, 'New York', 'New York', 43.00, -75.50, 'A', 'ADM1', 'US', 'NY', null, 0);

    // ADM2 records (for admin2/county name JOIN)
    insertPlace.run(5344994, 'El Dorado County', 'El Dorado County', 38.74, -120.52, 'A', 'ADM2', 'US', 'CA', '017', 0);
    insertFts.run('El Dorado County', '5344994', 'primary');
    insertPlace.run(5391832, 'San Francisco County', 'San Francisco County', 37.78, -122.42, 'A', 'ADM2', 'US', 'CA', '075', 0);

    // London, UK — large city
    insertPlace.run(2643743, 'London', 'London', 51.5074, -0.1278, 'P', 'PPLC', 'GB', 'ENG', null, 8982000);
    insertFts.run('London', '2643743', 'primary');

    // London, Ontario — smaller city
    insertPlace.run(6058560, 'London', 'London', 42.9834, -81.2330, 'P', 'PPL', 'CA', '08', null, 383822);
    insertFts.run('London', '6058560', 'primary');

    // Kaliningrad (formerly Königsberg)
    insertPlace.run(554234, 'Kaliningrad', 'Kaliningrad', 54.7104, 20.4522, 'P', 'PPLA', 'RU', '23', null, 489359);
    insertFts.run('Kaliningrad', '554234', 'primary');
    // Historic alternate name
    insertAlt.run(1, 554234, 'Königsberg', 'de', 1, 0);
    insertFts.run('Königsberg', '554234', 'historic');

    // New York City
    insertPlace.run(5128581, 'New York City', 'New York City', 40.7128, -74.0060, 'P', 'PPL', 'US', 'NY', null, 8336817);
    insertFts.run('New York City', '5128581', 'primary');

    // York, UK
    insertPlace.run(2633352, 'York', 'York', 53.9591, -1.0815, 'P', 'PPL', 'GB', 'ENG', null, 144202);
    insertFts.run('York', '2633352', 'primary');

    // Malmö, Sweden (diacritics test)
    insertPlace.run(2692969, 'Malmö', 'Malmo', 55.6059, 13.0007, 'P', 'PPLA', 'SE', '27', null, 301706);
    insertFts.run('Malmö', '2692969', 'primary');
    insertFts.run('Malmo', '2692969', 'alternate');

    // York Castle — structure (should rank below city)
    insertPlace.run(9999901, 'York Castle', 'York Castle', 53.9570, -1.0790, 'S', 'CSTL', 'GB', 'ENG', null, 0);
    insertFts.run('York Castle', '9999901', 'primary');

    // Pressburg (historical name for Bratislava)
    insertPlace.run(3060972, 'Bratislava', 'Bratislava', 48.1486, 17.1077, 'P', 'PPLC', 'SK', '02', null, 437725);
    insertFts.run('Bratislava', '3060972', 'primary');
    insertAlt.run(2, 3060972, 'Pressburg', 'de', 1, 0);
    insertFts.run('Pressburg', '3060972', 'historic');
    insertAlt.run(3, 3060972, 'Pozsony', 'hu', 1, 0);
    insertFts.run('Pozsony', '3060972', 'historic');

    // Historical populated place (no longer exists)
    insertPlace.run(9999902, 'Dunwich', 'Dunwich', 52.2767, 1.6317, 'P', 'PPLH', 'GB', 'ENG', null, 0);
    insertFts.run('Dunwich', '9999902', 'primary');

    // Grizzly Flat — place in El Dorado County, CA (admin2 test)
    insertPlace.run(5350964, 'Grizzly Flat', 'Grizzly Flat', 38.6449, -120.5227, 'P', 'PPL', 'US', 'CA', '017', 268);
    insertFts.run('Grizzly Flat', '5350964', 'primary');
    insertAlt.run(4, 5350964, 'Grizzly Flats', 'en', 0, 0);
    insertFts.run('Grizzly Flats', '5350964', 'alternate');

    // ─── Italian admin regions (for qualifier matching tests) ───
    insertCountry.run('IT', 'Italy');

    // ADM1: Toscana (Tuscany)
    insertPlace.run(3165361, 'Toscana', 'Toscana', 43.35, 11.02, 'A', 'ADM1', 'IT', '16', null, 0);
    insertFts.run('Toscana', '3165361', 'primary');
    insertAlt.run(10, 3165361, 'Tuscany', 'en', 0, 0);
    insertFts.run('Tuscany', '3165361', 'alternate');

    // ADM2: Provincia di Lucca
    insertPlace.run(3174530, 'Provincia di Lucca', 'Provincia di Lucca', 44.00, 10.50, 'A', 'ADM2', 'IT', '16', 'LU', 0);
    insertFts.run('Provincia di Lucca', '3174530', 'primary');
    insertAlt.run(11, 3174530, 'Lucca', 'it', 0, 0);
    insertFts.run('Lucca', '3174530', 'alternate');
    insertAlt.run(12, 3174530, 'Province of Lucca', 'en', 0, 0);
    insertFts.run('Province of Lucca', '3174530', 'alternate');

    // Massarosa — town in Provincia di Lucca, Toscana, Italy
    insertPlace.run(3173631, 'Massarosa', 'Massarosa', 43.87, 10.34, 'P', 'PPL', 'IT', '16', 'LU', 10082);
    insertFts.run('Massarosa', '3173631', 'primary');

    return { db: GeonamesDb.fromConnection(raw), raw };
}

describe('GeonamesDb', () => {
    let db: GeonamesDb;
    let raw: DatabaseSync;

    beforeAll(() => {
        const result = createTestDb();
        db = result.db;
        raw = result.raw;
    });

    afterAll(() => {
        raw.close();
    });

    it('searchByName returns results for a known city', () => {
        const results = db.searchByName('London', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('London');
        expect(results[0].lat).toBeCloseTo(51.5074, 3);
        expect(results[0].lng).toBeCloseTo(-0.1278, 3);
        expect(results[0].countryCode).toBe('GB');
    });

    it('admin1Name is populated from ADM1 join', () => {
        const results = db.searchByName('London', 5);
        expect(results[0].admin1Name).toBe('England');
        expect(results[1].admin1Name).toBe('Ontario');
    });

    it('higher population ranks above lower population for same name', () => {
        const results = db.searchByName('London', 5);
        // London UK (8.9M) should be before London Ontario (383K)
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[0].countryCode).toBe('GB');
        expect(results[1].countryCode).toBe('CA');
    });

    it('prefix search returns matching results', () => {
        const results = db.searchByName('Lon', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some(r => r.primaryName === 'London')).toBe(true);
    });

    it('historic alternate name matches and returns modern primary name', () => {
        const results = db.searchByName('Königsberg', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('Kaliningrad');
        expect(results[0].matchedName).toBe('Königsberg');
        expect(results[0].sourceType).toBe('historic');
    });

    it('diacritics-insensitive search: "Malmo" matches "Malmö"', () => {
        const results = db.searchByName('Malmo', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('Malmö');
    });

    it('exact match ranks above prefix match ("York" before "York Castle")', () => {
        const results = db.searchByName('York', 5);
        expect(results.length).toBeGreaterThanOrEqual(2);
        // The city "York" should come before "York Castle"
        expect(results[0].primaryName).toBe('York');
        expect(results[0].featureClass).toBe('P');
    });

    it('populated place ranks above structure with overlapping name', () => {
        const results = db.searchByName('York', 5);
        const yorkCity = results.findIndex(r => r.geonameid === 2633352);
        const yorkCastle = results.findIndex(r => r.geonameid === 9999901);
        expect(yorkCity).toBeLessThan(yorkCastle);
    });

    it('multi-word phrase prefix search works', () => {
        const results = db.searchByName('New Yor', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('New York City');
    });

    it('resolveByName returns best single result', () => {
        const result = db.resolveByName('London');
        expect(result).not.toBeNull();
        expect(result!.primaryName).toBe('London');
        expect(result!.countryCode).toBe('GB');
        expect(result!.population).toBe(8982000);
    });

    it('resolveByName returns null for unknown place', () => {
        const result = db.resolveByName('Zxqvbjk');
        expect(result).toBeNull();
    });

    it('resolveByName with historic name returns modern place', () => {
        const result = db.resolveByName('Pressburg');
        expect(result).not.toBeNull();
        expect(result!.primaryName).toBe('Bratislava');
        expect(result!.matchedName).toBe('Pressburg');
        expect(result!.sourceType).toBe('historic');
    });

    it('multiple historic names for the same place both resolve', () => {
        const r1 = db.resolveByName('Pressburg');
        const r2 = db.resolveByName('Pozsony');
        expect(r1).not.toBeNull();
        expect(r2).not.toBeNull();
        expect(r1!.geonameid).toBe(r2!.geonameid);
        expect(r1!.primaryName).toBe('Bratislava');
    });

    it('searchByName respects limit parameter', () => {
        const results = db.searchByName('London', 1);
        expect(results.length).toBe(1);
    });

    it('historical populated place (PPLH) appears in results', () => {
        const results = db.searchByName('Dunwich', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].featureCode).toBe('PPLH');
    });

    it('admin2Name is populated from ADM2 join', () => {
        const results = db.searchByName('Grizzly Flat', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].admin2Name).toBe('El Dorado County');
        expect(results[0].admin1Name).toBe('California');
    });

    it('searching for a county-level ADM2 place returns results', () => {
        const results = db.searchByName('El Dorado County', 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('El Dorado County');
        expect(results[0].featureCode).toBe('ADM2');
        expect(results[0].admin1Name).toBe('California');
    });

    it('searchFiltered with country name resolves to country code', () => {
        const results = db.searchFiltered('London', ['United Kingdom'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].countryCode).toBe('GB');
    });

    it('searchFiltered with country name prefix works', () => {
        const results = db.searchFiltered('London', ['United King'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].countryCode).toBe('GB');
    });

    it('searchFiltered with admin1 name and country name', () => {
        const results = db.searchFiltered('Grizzly Flat', ['California', 'United States'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].admin1Name).toBe('California');
        expect(results[0].countryCode).toBe('US');
    });

    it('searchFiltered matches short qualifier contained in admin2 name ("Lucca" → "Provincia di Lucca")', () => {
        const results = db.searchFiltered('Massarosa', ['Lucca', 'Italy'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('Massarosa');
        expect(results[0].admin2Name).toBe('Provincia di Lucca');
    });

    it('searchFiltered matches English alternate name for admin1 ("Tuscany" → "Toscana")', () => {
        const results = db.searchFiltered('Massarosa', ['Provincia di Lucca', 'Tuscany'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('Massarosa');
        expect(results[0].admin1Name).toBe('Toscana');
    });

    it('searchFiltered matches English alternate name for admin2 ("Province of Lucca" → "Provincia di Lucca")', () => {
        const results = db.searchFiltered('Massarosa', ['Province of Lucca', 'Italy'], 5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].primaryName).toBe('Massarosa');
        expect(results[0].admin2Name).toBe('Provincia di Lucca');
    });
});
