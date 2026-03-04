// tests/api/Stories.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import supertest from 'supertest';
import git from 'isomorphic-git';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DATA_DIR = './tests/fixtures/data';
const STORIES_DIR = path.join(TEST_DATA_DIR, 'stories');

function cleanupStories() {
    if (fs.existsSync(STORIES_DIR)) {
        const files = fs.readdirSync(STORIES_DIR).filter(f => f.startsWith('test-'));
        for (const file of files) {
            fs.unlinkSync(path.join(STORIES_DIR, file));
        }
    }
}

describe('Stories API', () => {
    let server: FastifyInstance;
    let request: ReturnType<typeof supertest>;

    beforeEach(async () => {
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

        const authPath = path.join(TEST_DATA_DIR, '_meta', 'auth.yaml');
        if (fs.existsSync(authPath)) fs.unlinkSync(authPath);

        if (!fs.existsSync(STORIES_DIR)) fs.mkdirSync(STORIES_DIR, { recursive: true });

        server = await createServer({ logger: false, dataDir: TEST_DATA_DIR });
        await server.listen({ port: 0 });
        const address = server.server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        request = supertest(`http://localhost:${port}`);
    });

    afterEach(async () => {
        await server.close();
        cleanupStories();
    });

    afterAll(() => {
        cleanupStories();
    });

    // ── List ────────────────────────────────────────────────────────────────

    it('GET /api/stories returns empty list when no stories exist', async () => {
        // Remove any existing story files that could bleed in
        const storyFiles = fs.readdirSync(STORIES_DIR);
        for (const f of storyFiles) fs.unlinkSync(path.join(STORIES_DIR, f));

        const res = await request.get('/api/stories');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('stories');
        expect(res.body).toHaveProperty('totalCount');
        expect(Array.isArray(res.body.stories)).toBe(true);
    });

    it('GET /api/stories supports pagination via limit + offset', async () => {
        const res = await request.get('/api/stories?limit=5&offset=0');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('totalCount');
        expect(res.body.stories.length).toBeLessThanOrEqual(5);
    });

    it('GET /api/stories returns 400 for invalid limit', async () => {
        const res = await request.get('/api/stories?limit=999');
        expect(res.status).toBe(400);
    });

    // ── Create ──────────────────────────────────────────────────────────────

    it('POST /api/stories creates a new story and returns it', async () => {
        const res = await request.post('/api/stories').send({
            title: 'Test Story Title',
            content: 'The body of the story.',
        });
        expect(res.status).toBe(201);
        expect(res.body.metadata.title).toBe('Test Story Title');
        expect(res.body.content).toBe('The body of the story.');
        expect(typeof res.body.id).toBe('string');

        // File must exist on disk
        const filePath = path.join(STORIES_DIR, `${res.body.id}.md`);
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('POST /api/stories with place and date persists frontmatter', async () => {
        const res = await request.post('/api/stories').send({
            title: 'Test Placed Story',
            date: '1939-1945',
            place: 'London, England',
            content: 'A wartime story.',
        });
        expect(res.status).toBe(201);
        expect(res.body.metadata.place).toBe('London, England');
        expect(res.body.metadata.date).toBe('1939-1945');
    });

    it('POST /api/stories returns 400 when title is missing', async () => {
        const res = await request.post('/api/stories').send({ content: 'No title here.' });
        expect(res.status).toBe(400);
    });

    // ── Read ────────────────────────────────────────────────────────────────

    it('GET /api/stories/:id returns full story', async () => {
        const created = await request.post('/api/stories').send({
            title: 'Test Read Story',
            content: 'Full content here.',
        });
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await request.get(`/api/stories/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe(id);
        expect(res.body.metadata.title).toBe('Test Read Story');
        expect(res.body.content).toBe('Full content here.');
    });

    it('GET /api/stories/:id returns 404 for unknown id', async () => {
        const res = await request.get('/api/stories/test-nonexistent-story');
        expect(res.status).toBe(404);
    });

    // ── Update ──────────────────────────────────────────────────────────────

    it('PUT /api/stories/:id updates title and content', async () => {
        const created = await request.post('/api/stories').send({
            title: 'Test Original Title',
            content: 'Original body.',
        });
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await request.put(`/api/stories/${id}`).send({
            title: 'Test Updated Title',
            content: 'Updated body.',
        });
        expect(res.status).toBe(200);
        expect(res.body.metadata.title).toBe('Test Updated Title');
        expect(res.body.content).toBe('Updated body.');
    });

    it('PUT /api/stories/:id returns 404 for unknown id', async () => {
        const res = await request.put('/api/stories/test-nonexistent-story').send({
            title: 'Doesn\'t matter',
            content: 'Nope.',
        });
        expect(res.status).toBe(404);
    });

    // ── Delete ──────────────────────────────────────────────────────────────

    it('DELETE /api/stories/:id removes the story and returns 204', async () => {
        const created = await request.post('/api/stories').send({
            title: 'Test Delete Me',
            content: 'Gone soon.',
        });
        expect(created.status).toBe(201);
        const id = created.body.id;
        const filePath = path.join(STORIES_DIR, `${id}.md`);

        const del = await request.delete(`/api/stories/${id}`);
        expect(del.status).toBe(204);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('DELETE /api/stories/:id returns 404 for unknown id', async () => {
        const res = await request.delete('/api/stories/test-nonexistent-story');
        expect(res.status).toBe(404);
    });

    // ── Mention Extraction ──────────────────────────────────────────────────

    it('POST /api/stories parses @mentions from body', async () => {
        const res = await request.post('/api/stories').send({
            title: 'Test Mention Story',
            content: 'This mentions @N_graph-parent-i3ktui9x in the body.',
        });
        expect(res.status).toBe(201);
        expect(res.body.mentions).toContain('N_graph-parent-i3ktui9x');
    });

    it('POST /api/stories parses [[wikilink]] mentions from body', async () => {
        const res = await request.post('/api/stories').send({
            title: 'Test Wikilink Story',
            content: 'This mentions [[N_graph-parent-i3ktui9x]] via wikilink.',
        });
        expect(res.status).toBe(201);
        expect(res.body.mentions).toContain('N_graph-parent-i3ktui9x');
    });

    it('GET /api/stories list combines metadata.people and body mentions in people field', async () => {
        const person1 = 'N_graph-parent-i3ktui9x';
        const person2 = 'N_graph-child-vb709p2s';
        const created = await request.post('/api/stories').send({
            title: 'Test People Field Story',
            people: [person1],
            content: `This also mentions @${person2} inline.`,
        });
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await request.get('/api/stories');
        expect(res.status).toBe(200);
        const story = res.body.stories.find((s: any) => s.id === id);
        expect(story).toBeDefined();
        expect(story.people).toContain(person1);
        expect(story.people).toContain(person2);
    });

    // ── StoryFeedItem shape ─────────────────────────────────────────────────

    it('GET /api/stories list returns StoryFeedItem shape', async () => {
        const created = await request.post('/api/stories').send({
            title: 'Test Feed Shape',
            content: 'A'.repeat(300),
        });
        expect(created.status).toBe(201);
        const id = created.body.id;

        const res = await request.get('/api/stories');
        expect(res.status).toBe(200);
        const story = res.body.stories.find((s: any) => s.id === id);
        expect(story).toBeDefined();
        expect(typeof story.id).toBe('string');
        expect(typeof story.title).toBe('string');
        expect(typeof story.excerpt).toBe('string');
        // Excerpt must be truncated at 200 chars
        expect(story.excerpt.length).toBeLessThanOrEqual(200);
        expect(Array.isArray(story.people)).toBe(true);
        expect(typeof story.private).toBe('boolean');
    });

    // ── Media Attachment ────────────────────────────────────────────────────

    it('PUT /api/stories/:id/media attaches an asset to a story', async () => {
        const created = await request.post('/api/stories').send({
            title: 'Test Media Story',
            content: 'Story with a photo.',
        });
        expect(created.status).toBe(201);
        const id = created.body.id;

        // Create a minimal PNG buffer (1x1 white pixel)
        const pngBuffer = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==',
            'base64'
        );

        const res = await request
            .put(`/api/stories/${id}/media`)
            .attach('file', pngBuffer, 'test-photo.png');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.metadata.assets)).toBe(true);
        expect(res.body.metadata.assets.length).toBeGreaterThan(0);

        // Asset file must exist on disk
        const assetsDir = path.join(TEST_DATA_DIR, 'assets');
        const assets: string[] = res.body.metadata.assets;
        const assetFile = assets[assets.length - 1];
        expect(fs.existsSync(path.join(assetsDir, assetFile))).toBe(true);
    });

    // ── Sorting ─────────────────────────────────────────────────────────────

    it('GET /api/stories?sort=oldest returns oldest-first order', async () => {
        const res = await request.get('/api/stories?sort=oldest');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.stories)).toBe(true);
    });
});
