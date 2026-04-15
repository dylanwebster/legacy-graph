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

    // Helper: start a scan and wait for it to complete via polling
    async function startAndWaitForScan(): Promise<any> {
        const startRes = await request.post('/api/geocoding/batch/start').send({}).expect(200);
        expect(startRes.body.status).toBe('running');
        expect(startRes.body.jobId).toBeTruthy();

        // Poll for results (the job runs in background)
        let results: any = null;
        for (let i = 0; i < 50; i++) {
            const res = await request.get('/api/geocoding/batch/results');
            if (res.status === 200) {
                results = res.body;
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        expect(results).not.toBeNull();
        return results;
    }

    describe('POST /api/geocoding/batch/start', () => {
        it('starts a background scan and returns job ID', async () => {
            const res = await request.post('/api/geocoding/batch/start').send({}).expect(200);
            expect(res.body.jobId).toBeTruthy();
            expect(res.body.status).toBe('running');
        });

        it('is idempotent — returns same job or completed if fast', async () => {
            const res1 = await request.post('/api/geocoding/batch/start').send({}).expect(200);
            const res2 = await request.post('/api/geocoding/batch/start').send({}).expect(200);
            // With small test data, the job may complete before the second request.
            // Either we get the same running job ID, or completed status.
            if (res2.body.status === 'running') {
                expect(res2.body.jobId).toBe(res1.body.jobId);
            } else {
                expect(res2.body.status).toBe('completed');
            }
        });

        it('returns completed status if results already exist on disk', async () => {
            await startAndWaitForScan();

            const res = await request.post('/api/geocoding/batch/start').send({}).expect(200);
            expect(res.body.status).toBe('completed');
            expect(res.body.jobId).toBeNull();
        });
    });

    describe('GET /api/geocoding/batch/results', () => {
        it('returns 404 when no results exist', async () => {
            await request.get('/api/geocoding/batch/results').expect(404);
        });

        it('returns 202 when job is running', async () => {
            await request.post('/api/geocoding/batch/start').send({});
            // Immediately check — might still be running
            const res = await request.get('/api/geocoding/batch/results');
            expect([200, 202]).toContain(res.status);
        });

        it('returns results grouped by confidence after scan completes', async () => {
            const body = await startAndWaitForScan();

            expect(body.stats.alreadyResolved).toBe(1);
            expect(body.stats.total).toBeGreaterThanOrEqual(3);

            // Fresno should be high confidence
            const fresnoResult = body.results.find((r: any) => r.locationString === 'Fresno, California, USA');
            expect(fresnoResult).toBeDefined();
            expect(fresnoResult.match).not.toBeNull();
            expect(fresnoResult.match.confidence).toBe('high');
            expect(fresnoResult.match.place.name).toBe('Fresno');
            expect(fresnoResult.match.siteName).toBeNull();
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
            const churchResult = body.results.find((r: any) => r.locationString.includes('Nativity'));
            expect(churchResult).toBeDefined();
            expect(churchResult.match).not.toBeNull();
            expect(churchResult.match.siteName).toBe('Nativity Of The Blessed Virgin Mary Church');
        });

        it('includes auto-selected high and medium confidence in selections', async () => {
            const body = await startAndWaitForScan();

            expect(body.selections).toBeDefined();
            expect(body.selections.filter).toBe('all');
            expect(body.selections.searchQuery).toBe('');

            // High and medium should be auto-checked
            const checked = new Set(body.selections.checked);
            for (const r of body.results) {
                if (r.match && (r.match.confidence === 'high' || r.match.confidence === 'medium')) {
                    expect(checked.has(r.locationString)).toBe(true);
                }
            }
        });
    });

    describe('PUT /api/geocoding/batch/selections', () => {
        it('returns 404 when no results exist', async () => {
            await request.put('/api/geocoding/batch/selections')
                .send({ checked: [], filter: 'all', searchQuery: '' })
                .expect(404);
        });

        it('persists user selection state', async () => {
            await startAndWaitForScan();

            await request.put('/api/geocoding/batch/selections')
                .send({ checked: ['Fresno, California, USA'], filter: 'high', searchQuery: 'fresno' })
                .expect(200);

            const res = await request.get('/api/geocoding/batch/results').expect(200);
            expect(res.body.selections.checked).toEqual(['Fresno, California, USA']);
            expect(res.body.selections.filter).toBe('high');
            expect(res.body.selections.searchQuery).toBe('fresno');
        });
    });

    describe('DELETE /api/geocoding/batch/results', () => {
        it('clears persisted results', async () => {
            await startAndWaitForScan();

            await request.delete('/api/geocoding/batch/results').expect(200);
            await request.get('/api/geocoding/batch/results').expect(404);
        });

        it('allows starting a new scan after clearing', async () => {
            await startAndWaitForScan();
            await request.delete('/api/geocoding/batch/results').expect(200);

            const res = await request.post('/api/geocoding/batch/start').send({}).expect(200);
            expect(res.body.status).toBe('running');
            expect(res.body.jobId).toBeTruthy();
        });
    });

    describe('POST /api/geocoding/batch/apply', () => {
        it('updates person files', async () => {
            const scanBody = await startAndWaitForScan();
            const fresnoResult = scanBody.results.find((r: any) => r.locationString === 'Fresno, California, USA');

            const applyRes = await request.post('/api/geocoding/batch/apply').send({
                updates: [{
                    locationString: 'Fresno, California, USA',
                    place: fresnoResult.match.place,
                    siteName: null,
                }],
            }).expect(200);

            expect(applyRes.body.updated).toBe(2);
            expect(applyRes.body.eventsUpdated).toBe(2);

            // Verify YAML was updated
            const aliceYaml = yaml.load(fs.readFileSync(path.join(dataDir, 'people', 'N_alice-smith-1900-test1234.yaml'), 'utf8')) as any;
            const birthEvent = aliceYaml.events.find((e: any) => e.id === 'evt-1');
            expect(birthEvent.location.name).toBe('Fresno');
            expect(birthEvent.location.lat).toBeCloseTo(36.7378, 2);
            expect(birthEvent.location.resolvedAt).toBeDefined();

            // Verify original location preserved in _gedcom
            expect(aliceYaml._gedcom.original_locations['evt-1']).toBe('Fresno, California, USA');
        });

        it('sets site_name from dropped parts', async () => {
            const scanBody = await startAndWaitForScan();
            const churchResult = scanBody.results.find((r: any) => r.locationString.includes('Nativity'));

            await request.post('/api/geocoding/batch/apply').send({
                updates: [{
                    locationString: churchResult.locationString,
                    place: churchResult.match.place,
                    siteName: churchResult.match.siteName,
                }],
            }).expect(200);

            const bobYaml = yaml.load(fs.readFileSync(path.join(dataDir, 'people', 'N_bob-jones-1910-test5678.yaml'), 'utf8')) as any;
            const marriageEvent = bobYaml.events.find((e: any) => e.id === 'evt-4');
            expect(marriageEvent.site_name).toBe('Nativity Of The Blessed Virgin Mary Church');
            expect(marriageEvent.location.name).toBe('Chicopee');
        });

        it('clears persisted results after successful apply', async () => {
            const scanBody = await startAndWaitForScan();
            const fresnoResult = scanBody.results.find((r: any) => r.locationString === 'Fresno, California, USA');

            await request.post('/api/geocoding/batch/apply').send({
                updates: [{ locationString: 'Fresno, California, USA', place: fresnoResult.match.place, siteName: null }],
            }).expect(200);

            // Results should be cleared
            await request.get('/api/geocoding/batch/results').expect(404);
        });

        it('skips already-resolved events on re-scan', async () => {
            const scanBody = await startAndWaitForScan();
            const fresnoResult = scanBody.results.find((r: any) => r.locationString === 'Fresno, California, USA');

            await request.post('/api/geocoding/batch/apply').send({
                updates: [{ locationString: 'Fresno, California, USA', place: fresnoResult.match.place, siteName: null }],
            }).expect(200);

            // Scan again
            const scanBody2 = await startAndWaitForScan();
            const fresnoResult2 = scanBody2.results.find((r: any) => r.locationString === 'Fresno, California, USA');
            expect(fresnoResult2).toBeUndefined();

            expect(scanBody2.stats.alreadyResolved).toBeGreaterThan(scanBody.stats.alreadyResolved);
        });

        it('returns 400 for empty updates', async () => {
            await request.post('/api/geocoding/batch/apply').send({ updates: [] }).expect(400);
            await request.post('/api/geocoding/batch/apply').send({}).expect(400);
        });
    });

    describe('GET /api/geocoding/batch/stream', () => {
        it('streams SSE events including complete', async () => {
            // Start the scan and connect to stream
            await request.post('/api/geocoding/batch/start').send({}).expect(200);

            // Connect to SSE stream and collect events
            // Note: with small test data the job may already be complete, in which case
            // we get just a 'complete' event from the persisted results.
            const events: Array<{ event: string; data: any }> = [];

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('SSE timeout')), 5000);

                request.get('/api/geocoding/batch/stream')
                    .buffer(true)
                    .parse((res, callback) => {
                        let buffer = '';
                        res.on('data', (chunk: Buffer) => {
                            buffer += chunk.toString();
                            // Parse SSE events
                            const parts = buffer.split('\n\n');
                            buffer = parts.pop()!; // Keep incomplete part
                            for (const part of parts) {
                                const eventMatch = part.match(/event: (\w+)\ndata: (.+)/s);
                                if (eventMatch) {
                                    events.push({
                                        event: eventMatch[1],
                                        data: JSON.parse(eventMatch[2]),
                                    });
                                    if (eventMatch[1] === 'complete') {
                                        clearTimeout(timeout);
                                        resolve();
                                    }
                                }
                            }
                        });
                        res.on('end', () => {
                            clearTimeout(timeout);
                            resolve();
                            callback(null, '');
                        });
                        res.on('error', callback);
                    })
                    .end();
            });

            // Should have a complete event (progress events are optional with small data)
            const progressEvents = events.filter(e => e.event === 'progress');
            const completeEvents = events.filter(e => e.event === 'complete');

            expect(completeEvents.length).toBe(1);

            // If we got progress events, they should have expected shape
            for (const pe of progressEvents) {
                expect(pe.data).toHaveProperty('processed');
                expect(pe.data).toHaveProperty('total');
                expect(pe.data).toHaveProperty('percent');
            }

            // Complete event should have results
            expect(completeEvents[0].data).toHaveProperty('results');
            expect(completeEvents[0].data).toHaveProperty('stats');
        });

        it('sends complete immediately if results already exist', async () => {
            await startAndWaitForScan();

            const events: Array<{ event: string; data: any }> = [];

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('SSE timeout')), 2000);

                request.get('/api/geocoding/batch/stream')
                    .buffer(true)
                    .parse((res, callback) => {
                        let buffer = '';
                        res.on('data', (chunk: Buffer) => {
                            buffer += chunk.toString();
                            const parts = buffer.split('\n\n');
                            buffer = parts.pop()!;
                            for (const part of parts) {
                                const eventMatch = part.match(/event: (\w+)\ndata: (.+)/s);
                                if (eventMatch) {
                                    events.push({
                                        event: eventMatch[1],
                                        data: JSON.parse(eventMatch[2]),
                                    });
                                    if (eventMatch[1] === 'complete') {
                                        clearTimeout(timeout);
                                        resolve();
                                    }
                                }
                            }
                        });
                        res.on('end', () => {
                            clearTimeout(timeout);
                            resolve();
                            callback(null, '');
                        });
                        res.on('error', callback);
                    })
                    .end();
            });

            // Should get complete immediately with no progress events
            expect(events.length).toBe(1);
            expect(events[0].event).toBe('complete');
            expect(events[0].data).toHaveProperty('results');
        });
    });
});
