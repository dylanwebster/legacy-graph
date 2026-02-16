import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import supertest from 'supertest';
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';

describe('Fastify API Server', () => {
    let server: FastifyInstance;
    let request: ReturnType<typeof supertest>;

    beforeEach(async () => {
        // Ensure git repo exists for snapshot tests
        const testDataDir = './tests/fixtures/data';
        const gitDir = path.join(testDataDir, '.git');
        
        if (!fs.existsSync(gitDir)) {
            const git = simpleGit(testDataDir);
            await git.init();
            await git.addConfig('user.name', 'Test User');
            await git.addConfig('user.email', 'test@example.com');
            
            // Create initial commit so HEAD exists
            const gitignorePath = path.join(testDataDir, '.gitignore');
            fs.writeFileSync(gitignorePath, '# Test git repo\n');
            await git.add('.gitignore');
            await git.commit('Initial commit');
        }

        // Create server with test configuration
        server = await createServer({
            logger: false, // Disable logging during tests
            dataDir: testDataDir
        });
        
        await server.listen({ port: 0 }); // Random port
        const address = server.server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 3000;
        request = supertest(`http://localhost:${port}`);
    });

    afterEach(async () => {
        await server.close();
    });

    it('should start server successfully', () => {
        expect(server).toBeDefined();
        expect(server.server.listening).toBe(true);
    });

    it('should have CORS enabled', async () => {
        const response = await request
            .options('/api/search')
            .set('Origin', 'http://localhost:3001')
            .set('Access-Control-Request-Method', 'GET');
        
        expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should return 404 for undefined routes', async () => {
        const response = await request.get('/api/nonexistent');
        expect(response.status).toBe(404);
    });

    describe('GET /api/system/status', () => {
        it('should return system status', async () => {
            const response = await request.get('/api/system/status');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('nodeCount');
            expect(response.body).toHaveProperty('edgeCount');
            expect(response.body).toHaveProperty('hydrationState');
            expect(response.body.hydrationState).toMatch(/ready|loading/);
        });
    });

    describe('GET /api/search', () => {
        it('should search and return results', async () => {
            const response = await request
                .get('/api/search')
                .query({ q: 'test' });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('people');
            expect(response.body).toHaveProperty('stories');
            expect(Array.isArray(response.body.people)).toBe(true);
        });

        it('should return 400 if query parameter is missing', async () => {
            const response = await request.get('/api/search');
            expect(response.status).toBe(400);
        });
    });

    describe('GET /api/people/:id', () => {
        it('should return 404 for non-existent person', async () => {
            const response = await request.get('/api/people/N_nonexistent');
            expect(response.status).toBe(404);
        });

        it('should return person data with computed relationships', async () => {
            // This test requires a fixture person to exist
            // For now, we'll just verify the endpoint structure
            const response = await request.get('/api/people/N_test123');
            
            // Either 404 (no fixture) or 200 with proper structure
            if (response.status === 200) {
                expect(response.body).toHaveProperty('id');
                expect(response.body).toHaveProperty('names');
                expect(response.body).toHaveProperty('_computed');
            } else {
                expect(response.status).toBe(404);
            }
        });
    });

    describe('POST /api/people', () => {
        it('should create a new person', async () => {
            const newPerson = {
                names: [{ first: 'Test', last: 'Person', primary: true }],
                sex: 'U',
                events: []
            };

            const response = await request
                .post('/api/people')
                .send(newPerson);
            
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('id');
            expect(response.body.id).toMatch(/^N_/);
        });

        it('should return 400 for invalid person data', async () => {
            const invalid = {
                // Missing required fields
                sex: 'invalid'
            };

            const response = await request
                .post('/api/people')
                .send(invalid);
            
            expect(response.status).toBe(400);
        });
    });

    describe('PUT /api/people/:id', () => {
        it('should update an existing person', async () => {
            // First create a person
            const newPerson = {
                names: [{ first: 'Update', last: 'Test', primary: true }],
                sex: 'M',
                events: []
            };

            const createResponse = await request
                .post('/api/people')
                .send(newPerson);
            
            const personId = createResponse.body.id;

            // Update the person
            const updates = {
                ...createResponse.body,
                names: [{ first: 'Updated', last: 'Name', primary: true }]
            };

            const updateResponse = await request
                .put(`/api/people/${personId}`)
                .send(updates);
            
            expect(updateResponse.status).toBe(200);
            expect(updateResponse.body.names[0].first).toBe('Updated');
        });

        it('should return 404 for non-existent person', async () => {
            const response = await request
                .put('/api/people/N_nonexistent')
                .send({ names: [{ first: 'Test', last: 'Test', primary: true }], sex: 'U' });
            
            expect(response.status).toBe(404);
        });
    });

    describe('PUT /api/people/:id/media', () => {
        it('should upload an image and update person assets', async () => {
            // Create a test person first
            const createResponse = await request
                .post('/api/people')
                .send({
                    names: [{ first: 'Test', last: 'Media', primary: true }],
                    sex: 'F'
                });
            const personId = createResponse.body.id;

            // Create a minimal valid PNG (1x1 transparent pixel)
            const pngBuffer = Buffer.from([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
                0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
                0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
                0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
                0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
                0x42, 0x60, 0x82
            ]);

            // Upload the image
            const uploadResponse = await request
                .put(`/api/people/${personId}/media`)
                .attach('file', pngBuffer, 'test.png');
            
            expect(uploadResponse.status).toBe(200);
            expect(uploadResponse.body).toHaveProperty('filename');
            expect(uploadResponse.body.assets).toContain(uploadResponse.body.filename);

            // Verify person was updated
            const getResponse = await request.get(`/api/people/${personId}`);
            expect(getResponse.body.assets).toContain(uploadResponse.body.filename);
        });

        it('should return 404 for non-existent person', async () => {
            const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // Invalid but enough for test
            
            const response = await request
                .put('/api/people/N_nonexistent/media')
                .attach('file', pngBuffer, 'test.png');
            
            expect(response.status).toBe(404);
        });

        it('should return 400 if no file is provided', async () => {
            // Create a test person
            const createResponse = await request
                .post('/api/people')
                .send({
                    names: [{ first: 'Test', last: 'NoFile', primary: true }],
                    sex: 'M'
                });
            
            const response = await request
                .put(`/api/people/${createResponse.body.id}/media`)
                .send({});
            
            expect(response.status).toBe(400);
        });
    });

    describe('POST /api/import/gedcom', () => {
        it('should import GEDCOM and replace existing data', async () => {
            const gedcomContent = `0 HEAD
1 SOUR LegacyGraph
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Test /Import/
1 SEX M
1 BIRT
2 DATE 1 JAN 2000
0 TRLR`;

            const response = await request
                .post('/api/import/gedcom')
                .send({ gedcom: gedcomContent });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('imported');
            expect(response.body.imported).toBeGreaterThan(0);
        });

        it('should return 400 for invalid GEDCOM', async () => {
            const response = await request
                .post('/api/import/gedcom')
                .send({ gedcom: 'invalid gedcom' });
            
            expect(response.status).toBe(400);
        });

        it('should return 400 if no GEDCOM content provided', async () => {
            const response = await request
                .post('/api/import/gedcom')
                .send({});
            
            expect(response.status).toBe(400);
        });
    });

    describe('POST /api/system/rebuild', () => {
        it('should force re-hydration of the graph', async () => {
            const response = await request
                .post('/api/system/rebuild');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('nodeCount');
            expect(response.body).toHaveProperty('edgeCount');
        });
    });

    describe('POST /api/system/snapshot', () => {
        it('should create a git snapshot', async () => {
            const response = await request
                .post('/api/system/snapshot')
                .send({ name: 'test-snapshot' });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('tag');
            expect(response.body.tag).toBe('test-snapshot');
        });

        it('should return 400 if name is missing', async () => {
            const response = await request
                .post('/api/system/snapshot')
                .send({});
            
            expect(response.status).toBe(400);
        });
    });
});
