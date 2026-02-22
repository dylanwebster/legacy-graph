import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';

const TEST_DIR = path.join(__dirname, 'temp_media_test');

describe('Static Asset Delivery (Phase 3.9.3)', () => {
    let server: FastifyInstance;

    beforeAll(async () => {
        // Setup mock data directory
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });

        fs.mkdirSync(path.join(TEST_DIR, 'people'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'stories'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'assets'), { recursive: true });

        // Create a mock asset file (1000 bytes of 'A')
        const assetPath = path.join(TEST_DIR, 'assets', 'test-media.mp4');
        fs.writeFileSync(assetPath, Buffer.alloc(1000, 'A'));

        // Initialize server
        server = await createServer({
            dataDir: TEST_DIR,
            port: 3000,
            awaitHydration: true
        });

        await server.ready();
    });

    afterAll(async () => {
        await server.close();
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should serve static assets from /assets route', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/assets/test-media.mp4'
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toHaveLength(1000);
        // fastify-static should detect the extension
        expect(response.headers['content-type']).toContain('video/mp4');
    });

    it('should inject aggressive Cache-Control and immutable headers', async () => {
        const response = await server.inject({
            method: 'GET',
            url: '/assets/test-media.mp4'
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toContain('max-age=31536000');
        expect(response.headers['cache-control']).toContain('immutable');
        expect(response.headers['etag']).toBeDefined();
    });

    it('should support HTTP Range requests for media streaming', async () => {
        // Request bytes 100-199
        const response = await server.inject({
            method: 'GET',
            url: '/assets/test-media.mp4',
            headers: {
                'Range': 'bytes=100-199'
            }
        });

        // 206 Partial Content
        expect(response.statusCode).toBe(206);
        // We requested 100 bytes (inclusive 100 to 199)
        expect(response.body).toHaveLength(100);
        expect(response.headers['content-range']).toBe('bytes 100-199/1000');
        expect(response.headers['accept-ranges']).toBe('bytes');
        expect(response.headers['content-length']).toBe('100');
    });
});
