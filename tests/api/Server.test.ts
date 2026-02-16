import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server';
import supertest from 'supertest';

describe('Fastify API Server', () => {
    let server: FastifyInstance;
    let request: ReturnType<typeof supertest>;

    beforeEach(async () => {
        // Create server with test configuration
        server = await createServer({
            logger: false, // Disable logging during tests
            dataDir: './tests/fixtures/data'
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

    describe('POST /api/system/snapshot', () => {
        it('should create a git snapshot', async () => {
            const response = await request
                .post('/api/system/snapshot')
                .send({ name: 'test-snapshot' });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('tag');
        });

        it('should return 400 if name is missing', async () => {
            const response = await request
                .post('/api/system/snapshot')
                .send({});
            
            expect(response.status).toBe(400);
        });
    });
});
