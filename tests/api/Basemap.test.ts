import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Basemap (PMTiles) routes', () => {
    let server: FastifyInstance;
    let tmp: string;
    let tilesFile: string;
    const ORIGINAL_ENV = process.env.PMTILES_PATH;

    beforeAll(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'basemap-test-'));
        await fs.mkdir(path.join(tmp, 'people'), { recursive: true });
        await fs.mkdir(path.join(tmp, 'assets'), { recursive: true });
        await fs.mkdir(path.join(tmp, '_meta'), { recursive: true });
        tilesFile = path.join(tmp, 'basemap.pmtiles');
        process.env.PMTILES_PATH = tilesFile;
        server = await createServer({ dataDir: tmp, logger: false, awaitHydration: true });
    });

    afterAll(async () => {
        await server.close();
        await fs.rm(tmp, { recursive: true, force: true });
        if (ORIGINAL_ENV === undefined) delete process.env.PMTILES_PATH;
        else process.env.PMTILES_PATH = ORIGINAL_ENV;
    });

    afterEach(async () => {
        try { await fs.unlink(tilesFile); } catch { /* ignore */ }
    });

    describe('GET /api/system/basemap', () => {
        it('reports a remote fallback when the local file is missing', async () => {
            const res = await server.inject({ method: 'GET', url: '/api/system/basemap' });
            expect(res.statusCode).toBe(200);
            const body = res.json() as { available: boolean; source: string; remoteUrl?: string };
            expect(body.available).toBe(true);
            expect(body.source).toBe('remote');
            expect(typeof body.remoteUrl).toBe('string');
        });

        it('reports local source with size when the file exists', async () => {
            // Fake PMTiles: "PMTiles" header + some bytes
            const content = Buffer.concat([Buffer.from('PMTiles', 'utf8'), Buffer.alloc(200, 0)]);
            await fs.writeFile(tilesFile, content);
            const res = await server.inject({ method: 'GET', url: '/api/system/basemap' });
            expect(res.statusCode).toBe(200);
            const body = res.json() as { available: boolean; source: string; sizeBytes: number };
            expect(body.available).toBe(true);
            expect(body.source).toBe('local');
            expect(body.sizeBytes).toBe(content.length);
        });
    });

    describe('GET /api/basemap/tiles', () => {
        it('returns 404 when file is missing', async () => {
            const res = await server.inject({ method: 'GET', url: '/api/basemap/tiles' });
            expect(res.statusCode).toBe(404);
        });

        it('serves the full file with 200 when no Range header', async () => {
            const content = Buffer.alloc(1024);
            content.write('PMTiles', 0, 'utf8');
            await fs.writeFile(tilesFile, content);
            const res = await server.inject({ method: 'GET', url: '/api/basemap/tiles' });
            expect(res.statusCode).toBe(200);
            expect(res.headers['accept-ranges']).toBe('bytes');
            expect(Number(res.headers['content-length'])).toBe(content.length);
        });

        it('honors Range header with 206 and correct slice', async () => {
            const content = Buffer.from('PMTiles' + 'X'.repeat(500), 'utf8');
            await fs.writeFile(tilesFile, content);
            const res = await server.inject({
                method: 'GET',
                url: '/api/basemap/tiles',
                headers: { range: 'bytes=10-29' },
            });
            expect(res.statusCode).toBe(206);
            expect(res.headers['content-range']).toBe(`bytes 10-29/${content.length}`);
            expect(Number(res.headers['content-length'])).toBe(20);
            const slice = Buffer.isBuffer(res.rawPayload) ? res.rawPayload : Buffer.from(res.payload);
            expect(slice.length).toBe(20);
        });

        it('rejects an unsatisfiable range with 416', async () => {
            const content = Buffer.alloc(100);
            await fs.writeFile(tilesFile, content);
            const res = await server.inject({
                method: 'GET',
                url: '/api/basemap/tiles',
                headers: { range: 'bytes=200-300' },
            });
            expect(res.statusCode).toBe(416);
        });
    });
});
