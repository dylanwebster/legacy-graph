// tests/api/Assets.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import supertest from 'supertest';
import git from 'isomorphic-git';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DATA_DIR = './tests/fixtures/data';
const ASSETS_DIR = path.join(TEST_DATA_DIR, 'assets');
const META_DIR = path.join(TEST_DATA_DIR, '_meta');

const TEST_ASSET = 'test-asset-gallery.png';
const TEST_ASSET_PATH = path.join(ASSETS_DIR, TEST_ASSET);

function ensureGitRepo() {
    const gitDir = path.join(TEST_DATA_DIR, '.git');
    return gitDir;
}

async function setupGit() {
    const gitDir = path.join(TEST_DATA_DIR, '.git');
    if (!fs.existsSync(gitDir)) {
        await git.init({ fs, dir: TEST_DATA_DIR });
        await git.setConfig({ fs, dir: TEST_DATA_DIR, path: 'user.name', value: 'Test User' });
        await git.setConfig({ fs, dir: TEST_DATA_DIR, path: 'user.email', value: 'test@example.com' });
        const gitignorePath = path.join(TEST_DATA_DIR, '.gitignore');
        fs.writeFileSync(gitignorePath, '# Test git repo\n');
        await git.add({ fs, dir: TEST_DATA_DIR, filepath: '.gitignore' });
        await git.commit({
            fs,
            dir: TEST_DATA_DIR,
            message: 'Initial commit',
            author: { name: 'Test User', email: 'test@example.com' }
        });
    }
}

function cleanupTestAssets() {
    if (fs.existsSync(ASSETS_DIR)) {
        const files = fs.readdirSync(ASSETS_DIR).filter(f => f.startsWith('test-asset'));
        for (const file of files) {
            try { fs.unlinkSync(path.join(ASSETS_DIR, file)); } catch { /* ignore */ }
        }
    }
    const metaAssetsYaml = path.join(META_DIR, 'assets.yaml');
    if (fs.existsSync(metaAssetsYaml)) {
        try { fs.unlinkSync(metaAssetsYaml); } catch { /* ignore */ }
    }
}

function writeTestAsset(filename = TEST_ASSET) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    // Write a minimal 1x1 PNG (89 bytes)
    const pngBytes = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
        'hex'
    );
    fs.writeFileSync(path.join(ASSETS_DIR, filename), pngBytes);
}

describe('Assets API', () => {
    let server: FastifyInstance;
    let request: ReturnType<typeof supertest>;

    beforeEach(async () => {
        ensureGitRepo();
        await setupGit();

        const authPath = path.join(TEST_DATA_DIR, '_meta', 'auth.yaml');
        if (fs.existsSync(authPath)) fs.unlinkSync(authPath);

        fs.mkdirSync(ASSETS_DIR, { recursive: true });
        cleanupTestAssets();

        server = await createServer({ logger: false, dataDir: TEST_DATA_DIR });
        await server.listen({ port: 0 });
        const address = server.server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        request = supertest(`http://localhost:${port}`);
    });

    afterEach(async () => {
        await server.close();
        cleanupTestAssets();
    });

    afterAll(() => {
        cleanupTestAssets();
    });

    // ── GET /api/assets ──────────────────────────────────────────────────────

    it('GET /api/assets returns empty list when no files', async () => {
        if (fs.existsSync(ASSETS_DIR)) {
            const files = fs.readdirSync(ASSETS_DIR).filter(f => f.startsWith('test-'));
            for (const f of files) fs.unlinkSync(path.join(ASSETS_DIR, f));
        }

        const res = await request.get('/api/assets');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('assets');
        expect(res.body).toHaveProperty('totalCount');
        expect(Array.isArray(res.body.assets)).toBe(true);
    });

    it('GET /api/assets includes file with correct size and isOrphan: true when unreferenced', async () => {
        writeTestAsset();

        const res = await request.get('/api/assets');
        expect(res.status).toBe(200);

        const item = res.body.assets.find((a: any) => a.filename === TEST_ASSET);
        expect(item).toBeDefined();
        expect(item.size).toBeGreaterThan(0);
        expect(item.isOrphan).toBe(true);
        expect(item.mimeType).toBe('image/png');
        expect(item.referencedBy.people).toEqual([]);
        expect(item.referencedBy.stories).toEqual([]);
        expect(item.referencedBy.events).toEqual([]);
    });

    it('GET /api/assets metadata has description (not caption) and no tagged_people', async () => {
        writeTestAsset();

        const res = await request.get('/api/assets');
        expect(res.status).toBe(200);

        const item = res.body.assets.find((a: any) => a.filename === TEST_ASSET);
        expect(item).toBeDefined();
        expect(item.metadata).toBeDefined();
        expect('tagged_people' in item.metadata).toBe(false);
        expect('caption' in item.metadata).toBe(false);
        // description and date_taken may be undefined but not caption/tagged_people
    });

    it('GET /api/assets sets referencedBy.people correctly for person-owned asset', async () => {
        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Asset', last: 'Tester' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        writeTestAsset();

        const res = await request.get('/api/assets');
        expect(res.status).toBe(200);

        const item = res.body.assets.find((a: any) => a.filename === TEST_ASSET);
        expect(item).toBeDefined();
        expect(item.isOrphan).toBe(false);
        expect(item.referencedBy.people).toContain(personId);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('GET /api/assets?type=image returns only image files', async () => {
        writeTestAsset('test-asset-gallery.png');
        // Also write a doc-type file
        fs.mkdirSync(ASSETS_DIR, { recursive: true });
        fs.writeFileSync(path.join(ASSETS_DIR, 'test-asset-gallery.pdf'), 'fake pdf');

        const res = await request.get('/api/assets?type=image');
        expect(res.status).toBe(200);

        const filenames = res.body.assets.map((a: any) => a.filename);
        expect(filenames).toContain('test-asset-gallery.png');
        expect(filenames).not.toContain('test-asset-gallery.pdf');

        // Cleanup
        try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-gallery.pdf')); } catch { /* ignore */ }
    });

    it('GET /api/assets?type=document returns only non-image files', async () => {
        writeTestAsset('test-asset-gallery.png');
        fs.mkdirSync(ASSETS_DIR, { recursive: true });
        fs.writeFileSync(path.join(ASSETS_DIR, 'test-asset-gallery.pdf'), 'fake pdf');

        const res = await request.get('/api/assets?type=document');
        expect(res.status).toBe(200);

        const filenames = res.body.assets.map((a: any) => a.filename);
        expect(filenames).not.toContain('test-asset-gallery.png');
        expect(filenames).toContain('test-asset-gallery.pdf');

        // Cleanup
        try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-gallery.pdf')); } catch { /* ignore */ }
    });

    it('GET /api/assets?sort=size&order=desc returns assets sorted by size descending', async () => {
        writeTestAsset('test-asset-gallery.png');
        // Write a larger file
        fs.writeFileSync(path.join(ASSETS_DIR, 'test-asset-gallery-big.png'), Buffer.alloc(1000, 0));

        const res = await request.get('/api/assets?sort=size&order=desc');
        expect(res.status).toBe(200);

        const sizes = (res.body.assets as any[])
            .filter((a: any) => a.filename.startsWith('test-asset-gallery'))
            .map((a: any) => a.size);
        // Should be descending
        for (let i = 1; i < sizes.length; i++) {
            expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
        }

        // Cleanup
        try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-gallery-big.png')); } catch { /* ignore */ }
    });

    it('GET /api/assets?q= filters by filename', async () => {
        writeTestAsset('test-asset-gallery.png');
        fs.writeFileSync(path.join(ASSETS_DIR, 'test-asset-unrelated.png'), Buffer.alloc(10, 0));

        const res = await request.get('/api/assets?q=gallery');
        expect(res.status).toBe(200);

        const filenames = res.body.assets.map((a: any) => a.filename);
        expect(filenames).toContain('test-asset-gallery.png');
        expect(filenames).not.toContain('test-asset-unrelated.png');

        // Cleanup
        try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-unrelated.png')); } catch { /* ignore */ }
    });

    it('GET /api/assets?q= filters by person display name', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'SearchableFirstName', last: 'SearchableLastName' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.get('/api/assets?q=SearchableFirstName');
        expect(res.status).toBe(200);
        const item = res.body.assets.find((a: any) => a.filename === TEST_ASSET);
        expect(item).toBeDefined();

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    // ── PUT /api/assets/:filename/meta ───────────────────────────────────────

    it('PUT /api/assets/:filename/meta updates description', async () => {
        writeTestAsset();

        const res = await request
            .put(`/api/assets/${TEST_ASSET}/meta`)
            .send({ description: 'A test description' });

        expect(res.status).toBe(200);
        expect(res.body.description).toBe('A test description');
        expect('tagged_people' in res.body).toBe(false);

        // Verify persistence
        const metaYaml = path.join(META_DIR, 'assets.yaml');
        expect(fs.existsSync(metaYaml)).toBe(true);
    });

    it('PUT /api/assets/:filename/meta accepts legacy caption as description', async () => {
        writeTestAsset();

        const res = await request
            .put(`/api/assets/${TEST_ASSET}/meta`)
            .send({ caption: 'Legacy caption value' });

        expect(res.status).toBe(200);
        expect(res.body.description).toBe('Legacy caption value');
    });

    it('PUT /api/assets/:filename/meta updates date', async () => {
        writeTestAsset();

        const res = await request
            .put(`/api/assets/${TEST_ASSET}/meta`)
            .send({ date: '1945-06' });

        expect(res.status).toBe(200);
        expect(res.body.date).toBe('1945-06');
    });

    it('PUT /api/assets/:filename/meta accepts legacy date_taken as date', async () => {
        writeTestAsset();

        const res = await request
            .put(`/api/assets/${TEST_ASSET}/meta`)
            .send({ date_taken: '1945-06' });

        expect(res.status).toBe(200);
        expect(res.body.date).toBe('1945-06');
    });

    it('PUT /api/assets/:filename/meta creates assets.yaml if absent', async () => {
        writeTestAsset();
        const metaYaml = path.join(META_DIR, 'assets.yaml');
        if (fs.existsSync(metaYaml)) fs.unlinkSync(metaYaml);

        const res = await request
            .put(`/api/assets/${TEST_ASSET}/meta`)
            .send({ description: 'Created fresh' });

        expect(res.status).toBe(200);
        expect(fs.existsSync(metaYaml)).toBe(true);
    });

    it('PUT /api/assets/:filename/meta returns 404 for missing file', async () => {
        const res = await request
            .put('/api/assets/nonexistent-file.png/meta')
            .send({ description: 'wont work' });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ASSET_NOT_FOUND');
    });

    // ── DELETE /api/assets/:filename ─────────────────────────────────────────

    it('DELETE /api/assets/:filename deletes orphan and returns 204', async () => {
        writeTestAsset();

        const res = await request.delete(`/api/assets/${TEST_ASSET}`);
        expect(res.status).toBe(204);
        expect(fs.existsSync(TEST_ASSET_PATH)).toBe(false);
    });

    it('DELETE /api/assets/:filename returns 409 when asset is referenced by a person', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Ref', last: 'Person' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.delete(`/api/assets/${TEST_ASSET}`);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('ASSET_REFERENCED');
        expect(res.body.referencedBy.people).toContain(personId);
        expect(fs.existsSync(TEST_ASSET_PATH)).toBe(true);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('DELETE /api/assets/:filename returns 404 for missing file', async () => {
        const res = await request.delete('/api/assets/does-not-exist.png');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ASSET_NOT_FOUND');
    });

    it('DELETE /api/assets/:filename?force=true deletes file and removes from person assets[]', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Force', last: 'Delete' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.delete(`/api/assets/${TEST_ASSET}?force=true`);
        expect(res.status).toBe(204);
        expect(fs.existsSync(TEST_ASSET_PATH)).toBe(false);

        // Person should no longer reference the deleted asset
        const personRes = await request.get(`/api/people/${personId}`);
        expect(personRes.status).toBe(200);
        expect(personRes.body.assets).not.toContain(TEST_ASSET);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('DELETE /api/assets/:filename?force=true still returns 404 for missing file', async () => {
        const res = await request.delete('/api/assets/does-not-exist.png?force=true');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ASSET_NOT_FOUND');
    });

    // ── POST /api/people/:id/assets/link ─────────────────────────────────────

    it('POST /api/people/:id/assets/link links an existing asset', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Link', last: 'Test' }],
            sex: 'U',
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request
            .post(`/api/people/${personId}/assets/link`)
            .send({ filename: TEST_ASSET });

        expect(res.status).toBe(200);
        expect(res.body.assets).toContain(TEST_ASSET);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('POST /api/people/:id/assets/link is idempotent', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Idem', last: 'Potent' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request
            .post(`/api/people/${personId}/assets/link`)
            .send({ filename: TEST_ASSET });

        expect(res.status).toBe(200);
        const occurrences = (res.body.assets as string[]).filter(a => a === TEST_ASSET).length;
        expect(occurrences).toBe(1);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('POST /api/people/:id/assets/link returns 404 for missing person', async () => {
        const res = await request
            .post('/api/people/N_does-not-exist-1900-xxxxxxxx/assets/link')
            .send({ filename: TEST_ASSET });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('PERSON_NOT_FOUND');
    });

    it('POST /api/people/:id/assets/link returns 400 for missing file on disk', async () => {
        const createRes = await request.post('/api/people').send({
            names: [{ first: 'No', last: 'File' }],
            sex: 'U',
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request
            .post(`/api/people/${personId}/assets/link`)
            .send({ filename: 'does-not-exist.png' });

        expect(res.status).toBe(400);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    // ── DELETE /api/people/:id/media/:filename (unlink-only) ─────────────────

    it('DELETE /api/people/:id/media/:filename unlinks asset but does NOT delete file from disk', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'Unlink', last: 'Test' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.delete(`/api/people/${personId}/media/${TEST_ASSET}`);
        expect(res.status).toBe(204);

        // File should still exist on disk
        expect(fs.existsSync(TEST_ASSET_PATH)).toBe(true);

        // Person should no longer reference it
        const personRes = await request.get(`/api/people/${personId}`);
        expect(personRes.status).toBe(200);
        expect(personRes.body.assets).not.toContain(TEST_ASSET);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    // ── GET /api/assets?personIds= ───────────────────────────────────────────

    describe('GET /api/assets with personIds filter', () => {
        it('returns only assets tagged with a specific person', async () => {
            writeTestAsset('test-asset-person-a.png');
            writeTestAsset('test-asset-person-b.png');

            const personARes = await request.post('/api/people').send({
                names: [{ first: 'PersonA', last: 'Filter' }],
                sex: 'U',
                assets: ['test-asset-person-a.png'],
            });
            expect(personARes.status).toBe(201);
            const personAId = personARes.body.id;

            const personBRes = await request.post('/api/people').send({
                names: [{ first: 'PersonB', last: 'Filter' }],
                sex: 'U',
                assets: ['test-asset-person-b.png'],
            });
            expect(personBRes.status).toBe(201);
            const personBId = personBRes.body.id;

            const res = await request.get(`/api/assets?personIds=${personAId}`);
            expect(res.status).toBe(200);

            const filenames = res.body.assets.map((a: any) => a.filename);
            expect(filenames).toContain('test-asset-person-a.png');
            expect(filenames).not.toContain('test-asset-person-b.png');

            // Cleanup
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personAId}.yaml`));
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personBId}.yaml`));
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-person-a.png')); } catch { /* ignore */ }
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-person-b.png')); } catch { /* ignore */ }
        });

        it('returns only assets tagged with ALL specified people (AND filter)', async () => {
            writeTestAsset('test-asset-shared.png');
            writeTestAsset('test-asset-only-first.png');

            const firstRes = await request.post('/api/people').send({
                names: [{ first: 'AndFirst', last: 'Filter' }],
                sex: 'U',
                assets: ['test-asset-shared.png', 'test-asset-only-first.png'],
            });
            expect(firstRes.status).toBe(201);
            const firstId = firstRes.body.id;

            const secondRes = await request.post('/api/people').send({
                names: [{ first: 'AndSecond', last: 'Filter' }],
                sex: 'U',
                assets: ['test-asset-shared.png'],
            });
            expect(secondRes.status).toBe(201);
            const secondId = secondRes.body.id;

            const res = await request.get(`/api/assets?personIds=${firstId},${secondId}`);
            expect(res.status).toBe(200);

            const filenames = res.body.assets.map((a: any) => a.filename);
            expect(filenames).toContain('test-asset-shared.png');
            expect(filenames).not.toContain('test-asset-only-first.png');

            // Cleanup
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${firstId}.yaml`));
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${secondId}.yaml`));
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-shared.png')); } catch { /* ignore */ }
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-only-first.png')); } catch { /* ignore */ }
        });

        it('personIds filter combines with text search q', async () => {
            writeTestAsset('test-asset-combo-alpha.png');
            writeTestAsset('test-asset-combo-beta.png');

            const personRes = await request.post('/api/people').send({
                names: [{ first: 'ComboFilter', last: 'Person' }],
                sex: 'U',
                assets: ['test-asset-combo-alpha.png', 'test-asset-combo-beta.png'],
            });
            expect(personRes.status).toBe(201);
            const personId = personRes.body.id;

            // q=alpha only matches the alpha file (beta does not contain alpha as substring)
            const res = await request.get(`/api/assets?personIds=${personId}&q=alpha`);
            expect(res.status).toBe(200);

            const filenames = res.body.assets.map((a: any) => a.filename);
            expect(filenames).toContain('test-asset-combo-alpha.png');
            expect(filenames).not.toContain('test-asset-combo-beta.png');

            // Cleanup
            fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-combo-alpha.png')); } catch { /* ignore */ }
            try { fs.unlinkSync(path.join(ASSETS_DIR, 'test-asset-combo-beta.png')); } catch { /* ignore */ }
        });
    });

    // ── DELETE /api/people/:id/assets/link/:filename ─────────────────────────

    it('DELETE /api/people/:id/assets/link/:filename unlinks asset from person.assets[]', async () => {
        writeTestAsset();

        const createRes = await request.post('/api/people').send({
            names: [{ first: 'ExplicitUnlink', last: 'Test' }],
            sex: 'U',
            assets: [TEST_ASSET],
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.delete(`/api/people/${personId}/assets/link/${TEST_ASSET}`);
        expect(res.status).toBe(204);

        // File should still exist on disk
        expect(fs.existsSync(TEST_ASSET_PATH)).toBe(true);

        // Person should no longer reference it
        const personRes = await request.get(`/api/people/${personId}`);
        expect(personRes.body.assets).not.toContain(TEST_ASSET);

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });

    it('DELETE /api/people/:id/assets/link/:filename returns 404 for missing person', async () => {
        const res = await request.delete('/api/people/N_no-one-1900-xxxxxxxx/assets/link/some.png');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('PERSON_NOT_FOUND');
    });

    it('DELETE /api/people/:id/assets/link/:filename returns 404 if not linked', async () => {
        const createRes = await request.post('/api/people').send({
            names: [{ first: 'NotLinked', last: 'Test' }],
            sex: 'U',
        });
        expect(createRes.status).toBe(201);
        const personId = createRes.body.id;

        const res = await request.delete(`/api/people/${personId}/assets/link/nonexistent.png`);
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ASSET_NOT_FOUND');

        // Cleanup
        fs.unlinkSync(path.join(TEST_DATA_DIR, 'people', `${personId}.yaml`));
    });
});
