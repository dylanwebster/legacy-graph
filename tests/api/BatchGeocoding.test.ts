import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import supertest from 'supertest';
import git from 'isomorphic-git';
import * as fs from 'fs';
import * as nodeFs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { DatabaseSync } from 'node:sqlite';

/**
 * Create a minimal GeoNames test DB with enough data for batch geocoding tests.
 */
function createTestGeonamesDb(dbPath: string): void {
    const db = new DatabaseSync(dbPath);
    db.exec(`
        CREATE TABLE geonames (
            geonameid INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
            feature_class TEXT NOT NULL, feature_code TEXT NOT NULL, country_code TEXT,
            admin1 TEXT, admin2 TEXT, population INTEGER DEFAULT 0
        );
        CREATE TABLE alternate_names (id INTEGER PRIMARY KEY, geonameid INTEGER NOT NULL, name TEXT NOT NULL, is_historic INTEGER DEFAULT 0);
        CREATE INDEX idx_altnames_geonameid ON alternate_names(geonameid);
        CREATE TABLE admin1_names (country_code TEXT NOT NULL, admin1_code TEXT NOT NULL, name TEXT NOT NULL, geonameid INTEGER NOT NULL, PRIMARY KEY (country_code, admin1_code));
        CREATE TABLE admin2_names (country_code TEXT NOT NULL, admin1_code TEXT NOT NULL, admin2_code TEXT NOT NULL, name TEXT NOT NULL, geonameid INTEGER NOT NULL, PRIMARY KEY (country_code, admin1_code, admin2_code));
        CREATE VIRTUAL TABLE names_fts USING fts5(name, tokenize = 'unicode61 remove_diacritics 2', content='', columnsize=0);
        CREATE TABLE fts_map (rowid INTEGER PRIMARY KEY, geonameid INTEGER NOT NULL, source_type TEXT NOT NULL, name TEXT NOT NULL);
        CREATE TABLE countries (code TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(code, name));
        CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX idx_geonames_lat_lng ON geonames(lat, lng);
    `);

    const insertCountry = db.prepare('INSERT INTO countries VALUES (?, ?)');
    insertCountry.run('US', 'United States');

    const insertPlace = db.prepare('INSERT INTO geonames VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO names_fts (rowid, name) VALUES (?, ?)');
    const insertFtsMap = db.prepare('INSERT INTO fts_map (rowid, geonameid, source_type, name) VALUES (?, ?, ?, ?)');
    const insertAdmin1 = db.prepare('INSERT INTO admin1_names VALUES (?, ?, ?, ?)');
    const insertAdmin2 = db.prepare('INSERT INTO admin2_names VALUES (?, ?, ?, ?, ?)');

    let ftsRowId = 0;
    const addFts = (name: string, geonameid: string, sourceType: string) => {
        ftsRowId++;
        insertFts.run(ftsRowId, name);
        insertFtsMap.run(ftsRowId, parseInt(geonameid), sourceType, name);
    };

    insertAdmin1.run('US', 'CA', 'California', 5332921);
    insertAdmin1.run('US', 'MA', 'Massachusetts', 6254926);
    insertAdmin2.run('US', 'CA', '017', 'El Dorado County', 5345659);

    // California ADM1
    insertPlace.run(5332921, 'California', 37.25, -119.75, 'A', 'ADM1', 'US', 'CA', null, 0);

    // Fresno, CA
    insertPlace.run(5350937, 'Fresno', 36.7378, -119.7871, 'P', 'PPL', 'US', 'CA', null, 542107);
    addFts('Fresno', '5350937', 'primary');

    // Grizzly Flats, CA
    insertPlace.run(5350964, 'Grizzly Flats', 38.6449, -120.5227, 'P', 'PPL', 'US', 'CA', '017', 268);
    addFts('Grizzly Flats', '5350964', 'primary');

    // Chicopee, MA
    insertPlace.run(4932879, 'Chicopee', 42.1487, -72.6079, 'P', 'PPL', 'US', 'MA', null, 55298);
    addFts('Chicopee', '4932879', 'primary');

    db.close();
}

function writePerson(dataDir: string, person: Record<string, any>): void {
    const filePath = path.join(dataDir, 'people', `${person.id}.yaml`);
    fs.writeFileSync(filePath, yaml.dump(person));
}

describe('Batch Geocoding API', () => {
    let server: FastifyInstance;
    let request: ReturnType<typeof supertest>;
    let dataDir: string;

    beforeEach(async () => {
        // Create temp data directory
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-geo-test-'));
        fs.mkdirSync(path.join(dataDir, 'people'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, '_meta'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'stories'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });

        // Init git repo
        await git.init({ fs: nodeFs, dir: dataDir });
        await git.setConfig({ fs: nodeFs, dir: dataDir, path: 'user.name', value: 'Test' });
        await git.setConfig({ fs: nodeFs, dir: dataDir, path: 'user.email', value: 'test@test.com' });
        fs.writeFileSync(path.join(dataDir, '.gitignore'), '');
        await git.add({ fs: nodeFs, dir: dataDir, filepath: '.gitignore' });
        await git.commit({ fs: nodeFs, dir: dataDir, message: 'init', author: { name: 'Test', email: 'test@test.com' } });

        // Create GeoNames DB
        const dbPath = path.join(dataDir, 'geonames.db');
        createTestGeonamesDb(dbPath);

        // Write test people with unresolved locations
        writePerson(dataDir, {
            version: '5.0',
            id: 'N_alice-smith-1900-test1234',
            created: '2026-01-01T00:00:00.000Z',
            last_modified: '2026-01-01T00:00:00.000Z',
            names: [{ first: 'Alice', last: 'Smith', primary: true }],
            events: [
                { id: 'evt-1', type: 'birth', date: '1900', sort_date: '1900-01-01', location: { name: 'Fresno, California, USA' }, assets: [] },
                { id: 'evt-2', type: 'death', date: '1970', sort_date: '1970-01-01', location: { name: 'Mountain, Grizzly Flats, El Dorado, California, USA' }, assets: [] },
            ],
            assets: [],
            relationships: { parents: [] },
            sex: 'F',
            tags: [],
            _gedcom: {},
        });

        writePerson(dataDir, {
            version: '5.0',
            id: 'N_bob-jones-1910-test5678',
            created: '2026-01-01T00:00:00.000Z',
            last_modified: '2026-01-01T00:00:00.000Z',
            names: [{ first: 'Bob', last: 'Jones', primary: true }],
            events: [
                { id: 'evt-3', type: 'birth', date: '1910', sort_date: '1910-01-01', location: { name: 'Fresno, California, USA' }, assets: [] },
                {
                    id: 'evt-4', type: 'marriage', partner_id: 'N_alice-smith-1900-test1234', date: '1930', sort_date: '1930-01-01',
                    location: { name: 'Nativity Of The Blessed Virgin Mary Church, Chicopee, MA, USA' }, assets: [],
                },
                {
                    id: 'evt-5', type: 'residence', date: '1940', sort_date: '1940-01-01',
                    location: { name: 'Fresno', lat: 36.7378, lng: -119.7871, countryCode: 'US', admin1Name: 'California', resolvedAt: '2026-01-01T00:00:00.000Z' },
                    assets: [],
                },
            ],
            assets: [],
            relationships: { parents: [] },
            sex: 'M',
            tags: [],
            _gedcom: {},
        });

        server = await createServer({
            logger: false,
            dataDir,
            geonamesDb: path.join(dataDir, 'geonames.db'),
        });
        await server.listen({ port: 0 });
        const address = server.server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        request = supertest(`http://localhost:${port}`);
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('POST /api/geocoding/batch returns results grouped by confidence', async () => {
        const res = await request.post('/api/geocoding/batch').send({}).expect(200);
        const body = res.body;

        expect(body.stats.alreadyResolved).toBe(1); // evt-5 is already resolved
        expect(body.stats.total).toBeGreaterThanOrEqual(3); // 3 unique unresolved strings

        // Fresno, California, USA should be high confidence
        const fresnoResult = body.results.find((r: any) => r.locationString === 'Fresno, California, USA');
        expect(fresnoResult).toBeDefined();
        expect(fresnoResult.match).not.toBeNull();
        expect(fresnoResult.match.confidence).toBe('high');
        expect(fresnoResult.match.place.name).toBe('Fresno');
        expect(fresnoResult.match.siteName).toBeNull();
        // Should have 2 occurrences (Alice birth + Bob birth)
        expect(fresnoResult.occurrences.length).toBe(2);

        // Mountain, Grizzly Flats should be medium with site name extracted
        const mountainResult = body.results.find((r: any) =>
            r.locationString === 'Mountain, Grizzly Flats, El Dorado, California, USA'
        );
        expect(mountainResult).toBeDefined();
        expect(mountainResult.match).not.toBeNull();
        expect(mountainResult.match.confidence).toBe('medium');
        expect(mountainResult.match.place.name).toBe('Grizzly Flats');
        expect(mountainResult.match.siteName).toBe('Mountain');

        // Church name should be extracted
        const churchResult = body.results.find((r: any) =>
            r.locationString.includes('Nativity')
        );
        expect(churchResult).toBeDefined();
        expect(churchResult.match).not.toBeNull();
        expect(churchResult.match.siteName).toBe('Nativity Of The Blessed Virgin Mary Church');
    });

    it('POST /api/geocoding/batch/apply updates person files', async () => {
        // First scan to get the results
        const scanRes = await request.post('/api/geocoding/batch').send({}).expect(200);
        const fresnoResult = scanRes.body.results.find((r: any) => r.locationString === 'Fresno, California, USA');

        // Apply the Fresno result
        const applyRes = await request.post('/api/geocoding/batch/apply').send({
            updates: [{
                locationString: 'Fresno, California, USA',
                place: fresnoResult.match.place,
                siteName: null,
            }],
        }).expect(200);

        expect(applyRes.body.updated).toBe(2); // Alice + Bob
        expect(applyRes.body.eventsUpdated).toBe(2); // evt-1 + evt-3

        // Verify YAML was updated
        const aliceYaml = yaml.load(fs.readFileSync(path.join(dataDir, 'people', 'N_alice-smith-1900-test1234.yaml'), 'utf8')) as any;
        const birthEvent = aliceYaml.events.find((e: any) => e.id === 'evt-1');
        expect(birthEvent.location.name).toBe('Fresno');
        expect(birthEvent.location.lat).toBeCloseTo(36.7378, 2);
        expect(birthEvent.location.resolvedAt).toBeDefined();

        // Verify original location preserved in _gedcom
        expect(aliceYaml._gedcom.original_locations['evt-1']).toBe('Fresno, California, USA');
    });

    it('POST /api/geocoding/batch/apply sets site_name from dropped parts', async () => {
        const scanRes = await request.post('/api/geocoding/batch').send({}).expect(200);
        const churchResult = scanRes.body.results.find((r: any) => r.locationString.includes('Nativity'));

        await request.post('/api/geocoding/batch/apply').send({
            updates: [{
                locationString: churchResult.locationString,
                place: churchResult.match.place,
                siteName: churchResult.match.siteName,
            }],
        }).expect(200);

        // Verify site_name was set
        const bobYaml = yaml.load(fs.readFileSync(path.join(dataDir, 'people', 'N_bob-jones-1910-test5678.yaml'), 'utf8')) as any;
        const marriageEvent = bobYaml.events.find((e: any) => e.id === 'evt-4');
        expect(marriageEvent.site_name).toBe('Nativity Of The Blessed Virgin Mary Church');
        expect(marriageEvent.location.name).toBe('Chicopee');
    });

    it('POST /api/geocoding/batch/apply skips already-resolved events', async () => {
        const scanRes = await request.post('/api/geocoding/batch').send({}).expect(200);
        const fresnoResult = scanRes.body.results.find((r: any) => r.locationString === 'Fresno, California, USA');

        // Apply Fresno
        await request.post('/api/geocoding/batch/apply').send({
            updates: [{ locationString: 'Fresno, California, USA', place: fresnoResult.match.place, siteName: null }],
        }).expect(200);

        // Scan again — Fresno should no longer appear as unresolved
        const scanRes2 = await request.post('/api/geocoding/batch').send({}).expect(200);
        const fresnoResult2 = scanRes2.body.results.find((r: any) => r.locationString === 'Fresno, California, USA');
        expect(fresnoResult2).toBeUndefined();

        // Already resolved count should have increased
        expect(scanRes2.body.stats.alreadyResolved).toBeGreaterThan(scanRes.body.stats.alreadyResolved);
    });

    it('POST /api/geocoding/batch/apply returns 400 for empty updates', async () => {
        await request.post('/api/geocoding/batch/apply').send({ updates: [] }).expect(400);
        await request.post('/api/geocoding/batch/apply').send({}).expect(400);
    });
});
