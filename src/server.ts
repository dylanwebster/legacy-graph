import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { GraphEngine } from './core/GraphEngine';
import { Person, PersonSchema } from './schemas/PersonSchema';
import { GedcomReader } from './core/gedcom/Import';
import simpleGit from 'simple-git';
import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { pipeline } from 'stream/promises';

export interface ServerConfig {
    logger?: boolean;
    dataDir: string;
    port?: number;
}

let graphEngine: GraphEngine | null = null;

export async function createServer(config: ServerConfig): Promise<FastifyInstance> {
    const server = Fastify({
        logger: config.logger ?? true
    });

    // Register CORS
    await server.register(cors, {
        origin: true // Allow all origins in development
    });

    // Register multipart for file uploads
    await server.register(multipart, {
        limits: {
            fileSize: 50 * 1024 * 1024 // 50MB max
        }
    });

    // Initialize GraphEngine singleton
    if (!graphEngine) {
        graphEngine = new GraphEngine(config.dataDir);
        try {
            await graphEngine.hydrate();
            console.log('[Server] GraphEngine hydrated successfully');
        } catch (error) {
            console.error('[Server] Failed to hydrate GraphEngine:', error);
        }
    }

    // System Status Endpoint
    server.get('/api/system/status', async (request, reply) => {
        const graph = graphEngine!.getGraph();
        
        return {
            nodeCount: graph.order,
            edgeCount: graph.size,
            hydrationState: 'ready', // TODO: Track actual hydration state
            cacheAge: null // TODO: Implement cache age tracking
        };
    });

    // Search Endpoint
    server.get<{
        Querystring: { q?: string }
    }>('/api/search', async (request, reply) => {
        const { q } = request.query;
        
        if (!q) {
            return reply.status(400).send({ 
                error: 'Query parameter "q" is required',
                code: 'MISSING_QUERY'
            });
        }

        try {
            const results = await graphEngine!.searchService.search(q);
            
            return {
                people: results.people,
                stories: results.stories,
                places: [] // TODO: Implement place search
            };
        } catch (error: any) {
            console.error('[API] Search error:', error);
            return reply.status(500).send({
                error: 'Search failed',
                code: 'SEARCH_ERROR',
                details: error.message
            });
        }
    });

    // Get Person by ID
    server.get<{
        Params: { id: string }
    }>('/api/people/:id', async (request, reply) => {
        const { id } = request.params;
        const graph = graphEngine!.getGraph();
        
        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        const nodeData = graph.getNodeAttributes(id);
        const person: Person = nodeData.data;
        
        // TODO: Add computed relationships from _computed cache
        // For now, return person with empty _computed
        return {
            ...person,
            _computed: {
                currentSpouse: null,
                siblings: [],
                children: [],
                allSpouses: []
            }
        };
    });

    // Create Person
    server.post<{
        Body: Partial<Person>
    }>('/api/people', async (request, reply) => {
        const body = request.body;
        
        try {
            // Validate required fields
            if (!body.names || body.names.length === 0) {
                return reply.status(400).send({
                    error: 'Names array is required',
                    code: 'VALIDATION_ERROR'
                });
            }

            if (!body.sex || !['M', 'F', 'I', 'U'].includes(body.sex)) {
                return reply.status(400).send({
                    error: 'Invalid sex value',
                    code: 'VALIDATION_ERROR'
                });
            }

            // Create new person
            const newPerson: Person = {
                version: '5.0',
                id: `N_${nanoid()}`,
                created: new Date().toISOString(),
                last_modified: new Date().toISOString(),
                names: body.names,
                sex: body.sex,
                tags: body.tags || [],
                relationships: body.relationships || { parents: [] },
                events: body.events || [],
                assets: body.assets || [],
                scrapbook_md: body.scrapbook_md || '',
                _gedcom: body._gedcom
            };

            // Validate with Zod
            PersonSchema.parse(newPerson);

            // Write to file system
            const peopleDir = path.join(config.dataDir, 'people');
            await fs.mkdir(peopleDir, { recursive: true });
            
            const filename = `${newPerson.id}.yaml`;
            const filepath = path.join(peopleDir, filename);
            
            await fs.writeFile(filepath, yaml.dump(newPerson));

            // Add to graph
            const graph = graphEngine!.getGraph();
            graph.addNode(newPerson.id, { type: 'person', data: newPerson });

            return reply.status(201).send(newPerson);
        } catch (error: any) {
            console.error('[API] Error creating person:', error);
            return reply.status(400).send({
                error: 'Invalid person data',
                code: 'VALIDATION_ERROR',
                details: error.message
            });
        }
    });

    // Update Person
    server.put<{
        Params: { id: string },
        Body: Person
    }>('/api/people/:id', async (request, reply) => {
        const { id } = request.params;
        const updates = request.body;
        const graph = graphEngine!.getGraph();
        
        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        try {
            // Update last_modified
            updates.last_modified = new Date().toISOString();
            
            // Validate
            PersonSchema.parse(updates);

            // Write to file system
            const filename = `${id}.yaml`;
            const filepath = path.join(config.dataDir, 'people', filename);
            await fs.writeFile(filepath, yaml.dump(updates));

            // Update graph
            graph.setNodeAttribute(id, 'data', updates);

            return updates;
        } catch (error: any) {
            console.error('[API] Error updating person:', error);
            return reply.status(400).send({
                error: 'Invalid person data',
                code: 'VALIDATION_ERROR',
                details: error.message
            });
        }
    });

    // Upload Media to Person
    server.put<{
        Params: { id: string }
    }>('/api/people/:id/media', async (request, reply) => {
        const { id } = request.params;
        const graph = graphEngine!.getGraph();
        
        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        try {
            // Get the uploaded file
            const data = await request.file();
            
            if (!data) {
                return reply.status(400).send({
                    error: 'No file provided',
                    code: 'MISSING_FILE'
                });
            }

            // Generate unique filename
            const ext = path.extname(data.filename);
            const uniqueFilename = `${nanoid()}${ext}`;
            
            // Ensure assets directory exists
            const assetsDir = path.join(config.dataDir, 'assets');
            await fs.mkdir(assetsDir, { recursive: true });
            
            // Save file to disk
            const filepath = path.join(assetsDir, uniqueFilename);
            await pipeline(data.file, require('fs').createWriteStream(filepath));

            // Update person's assets array
            const nodeData = graph.getNodeAttributes(id);
            const person: Person = nodeData.data;
            
            if (!person.assets.includes(uniqueFilename)) {
                person.assets.push(uniqueFilename);
            }
            
            // Update last_modified
            person.last_modified = new Date().toISOString();
            
            // Write updated person YAML
            const personFilename = `${id}.yaml`;
            const personFilepath = path.join(config.dataDir, 'people', personFilename);
            await fs.writeFile(personFilepath, yaml.dump(person));
            
            // Update graph
            graph.setNodeAttribute(id, 'data', person);

            return {
                filename: uniqueFilename,
                assets: person.assets
            };
        } catch (error: any) {
            // Handle multipart errors as 400 Bad Request
            if (error.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
                return reply.status(400).send({
                    error: 'No file provided',
                    code: 'MISSING_FILE'
                });
            }
            
            console.error('[API] Error uploading media:', error);
            return reply.status(500).send({
                error: 'Failed to upload media',
                code: 'UPLOAD_ERROR',
                details: error.message
            });
        }
    });

    // Import GEDCOM (Destructive)
    server.post<{
        Body: { gedcom?: string }
    }>('/api/import/gedcom', async (request, reply) => {
        const { gedcom } = request.body;
        
        if (!gedcom) {
            return reply.status(400).send({
                error: 'GEDCOM content is required',
                code: 'MISSING_GEDCOM'
            });
        }

        try {
            const reader = new GedcomReader();
            const result = await reader.parse(gedcom);
            
            if (result.people.length === 0) {
                return reply.status(400).send({
                    error: 'No valid people found in GEDCOM',
                    code: 'INVALID_GEDCOM'
                });
            }

            // Clear existing people directory (but keep .git)
            const peopleDir = path.join(config.dataDir, 'people');
            try {
                const files = await fs.readdir(peopleDir);
                await Promise.all(
                    files
                        .filter(f => f.endsWith('.yaml'))
                        .map(f => fs.unlink(path.join(peopleDir, f)))
                );
            } catch (err) {
                // People directory might not exist yet
                await fs.mkdir(peopleDir, { recursive: true });
            }

            // Write all imported people
            await Promise.all(
                result.people.map(person => {
                    const filename = `${person.id}.yaml`;
                    const filepath = path.join(peopleDir, filename);
                    return fs.writeFile(filepath, yaml.dump(person));
                })
            );

            // Force full hydration
            await graphEngine!.hydrate();

            return {
                imported: result.people.length,
                warnings: result.warnings
            };
        } catch (error: any) {
            console.error('[API] GEDCOM import error:', error);
            return reply.status(400).send({
                error: 'Failed to parse GEDCOM',
                code: 'INVALID_GEDCOM',
                details: error.message
            });
        }
    });

    // Force Re-hydration
    server.post('/api/system/rebuild', async (request, reply) => {
        try {
            // TODO: Invalidate tiered cache when implemented in Phase 3.5.3
            await graphEngine!.hydrate();
            
            const graph = graphEngine!.getGraph();
            return {
                nodeCount: graph.order,
                edgeCount: graph.size,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            console.error('[API] Rebuild error:', error);
            return reply.status(500).send({
                error: 'Failed to rebuild graph',
                code: 'REBUILD_ERROR',
                details: error.message
            });
        }
    });

    // Create Snapshot
    server.post<{
        Body: { name?: string }
    }>('/api/system/snapshot', async (request, reply) => {
        const { name } = request.body;
        
        if (!name) {
            return reply.status(400).send({
                error: 'Snapshot name is required',
                code: 'MISSING_NAME'
            });
        }

        try {
            const git = simpleGit(config.dataDir);
            
            // TODO: Flush pending commits (when TransactionManager has debounced queue in 3.5.1)
            
            // Check if git repo exists
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                return reply.status(500).send({
                    error: 'Not a git repository',
                    code: 'NOT_GIT_REPO'
                });
            }

            // Check if there are any commits
            try {
                await git.log();
            } catch (err) {
                // No commits yet - make an initial one
                try {
                    const gitignorePath = path.join(config.dataDir, '.gitignore');
                    await fs.writeFile(gitignorePath, '# LegacyGraph\n');
                    await git.add('.gitignore');
                    await git.commit('Initial commit');
                } catch (commitErr) {
                    // Ignore if already exists
                }
            }

            // Create annotated tag
            await git.addAnnotatedTag(name, `Snapshot: ${name}`);

            return {
                tag: name,
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            console.error('[API] Snapshot error:', error);
            return reply.status(500).send({
                error: 'Failed to create snapshot',
                code: 'SNAPSHOT_ERROR',
                details: error.message
            });
        }
    });

    return server;
}

// Graceful shutdown
export async function closeServer(server: FastifyInstance): Promise<void> {
    await server.close();
    graphEngine = null;
}
