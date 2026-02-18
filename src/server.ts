import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { GraphEngine } from './core/GraphEngine';
import { Person, PersonSchema, toSlimPerson } from './schemas/PersonSchema';
import { GedcomReader } from './core/gedcom/Import';
import git from 'isomorphic-git';
import * as nodeFs from 'fs';
import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { pipeline } from 'stream/promises';
import { AuthConfig } from './schemas/AuthSchema';
import {
    loadAuthConfig,
    authenticateUser,
    issueToken,
    registerAuthGuard
} from './api/middleware/auth';
import { sliceTimeline } from './core/TimelineSlicer';
import { TransactionManager } from './core/TransactionManager';

export interface ServerConfig {
    logger?: boolean;
    dataDir: string;
    port?: number;
    /** If false, createServer returns immediately while hydration runs in background (503 until ready).
     *  Defaults to true for backward compatibility (server blocks until graph is hydrated). */
    awaitHydration?: boolean;
}

let graphEngine: GraphEngine | null = null;
let txManager: TransactionManager | null = null;

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

    // Register cookie plugin for HttpOnly JWT cookies
    await server.register(cookie);

    // Load auth config and register auth guard
    const authConfig: AuthConfig | null = await loadAuthConfig(config.dataDir);
    if (authConfig) {
        registerAuthGuard(server, authConfig);
        console.log('[Server] Authentication enabled');
    } else {
        console.log('[Server] No auth config found — authentication disabled');
    }

    // Initialize GraphEngine (fresh for each server instance)
    graphEngine = new GraphEngine(config.dataDir);

    // Hydrate via background Worker Thread (spec 2.3B).
    // When awaitHydration is false, the server starts immediately and returns 503 until ready.
    const hydrationPromise = graphEngine.hydrateInBackground().then(() => {
        console.log('[Server] GraphEngine hydrated successfully');
    }).catch(error => {
        console.error('[Server] Failed to hydrate GraphEngine:', error);
    });

    if (config.awaitHydration !== false) {
        await hydrationPromise;
    }

    // Initialize TransactionManager for git-tracked writes (with write-event dedup wiring)
    txManager = new TransactionManager(config.dataDir, {
        onFileWritten: (absolutePath: string) => {
            graphEngine?.registerSelfWrite(absolutePath);
        }
    });

    // 503 Loading Gate — reject non-exempt endpoints while hydration is in progress (spec 2.3B)
    server.addHook('onRequest', async (request, reply) => {
        if (graphEngine && graphEngine.hydrationState !== 'ready') {
            const url = request.url;
            // Exempt endpoints: health check and auth endpoints
            if (url === '/api/system/status' ||
                url === '/api/auth/login' ||
                url === '/api/auth/logout') {
                return;
            }
            return reply.status(503).send({
                error: 'Graph is loading',
                code: 'HYDRATION_IN_PROGRESS'
            });
        }
    });

    // Clean up on server close
    server.addHook('onClose', async () => {
        if (txManager) {
            await txManager.destroy();
            txManager = null;
        }
        graphEngine = null;
    });

    // System Status Endpoint
    server.get('/api/system/status', async (request, reply) => {
        const graph = graphEngine!.getGraph();
        
        return {
            nodeCount: graph.order,
            edgeCount: graph.size,
            hydrationState: graphEngine!.hydrationState,
            cacheAge: graphEngine!.cacheAge
        };
    });

    // Auth: Login
    server.post<{
        Body: { username?: string; password?: string }
    }>('/api/auth/login', async (request, reply) => {
        const { username, password } = request.body || {};

        if (!username || !password) {
            return reply.status(400).send({
                error: 'Username and password are required',
                code: 'MISSING_CREDENTIALS'
            });
        }

        if (!authConfig) {
            return reply.status(500).send({
                error: 'Authentication is not configured',
                code: 'AUTH_NOT_CONFIGURED'
            });
        }

        const authenticatedUser = await authenticateUser(authConfig, username, password);
        if (!authenticatedUser) {
            return reply.status(401).send({
                error: 'Invalid username or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        const token = issueToken(authConfig, authenticatedUser);

        reply.setCookie('token', token, {
            httpOnly: true,
            path: '/',
            sameSite: 'strict',
            secure: false // Set to true in production with HTTPS
        });

        return { message: 'Login successful', username: authenticatedUser };
    });

    // Auth: Logout
    server.post('/api/auth/logout', async (request, reply) => {
        reply.clearCookie('token', {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: false
        });

        return { message: 'Logout successful' };
    });

    // Search Endpoint (with pagination)
    server.get<{
        Querystring: { q?: string; limit?: string; offset?: string }
    }>('/api/search', async (request, reply) => {
        const { q, limit: limitStr, offset: offsetStr } = request.query;
        
        if (!q) {
            return reply.status(400).send({ 
                error: 'Query parameter "q" is required',
                code: 'MISSING_QUERY'
            });
        }

        // Parse and validate pagination params
        const limit = limitStr ? parseInt(limitStr, 10) : 50;
        const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

        if (isNaN(limit) || limit < 0 || limit > 200) {
            return reply.status(400).send({
                error: 'limit must be between 0 and 200',
                code: 'VALIDATION_ERROR'
            });
        }

        if (isNaN(offset) || offset < 0) {
            return reply.status(400).send({
                error: 'offset must be >= 0',
                code: 'VALIDATION_ERROR'
            });
        }

        try {
            const results = await graphEngine!.searchService.search(q, { limit, offset });
            return results;
        } catch (error: any) {
            console.error('[API] Search error:', error);
            return reply.status(500).send({
                error: 'Search failed',
                code: 'SEARCH_ERROR',
                details: error.message
            });
        }
    });

    // Get Person by ID (with optional timeline pagination)
    server.get<{
        Params: { id: string },
        Querystring: { timeline_limit?: string; timeline_offset?: string }
    }>('/api/people/:id', async (request, reply) => {
        const { id } = request.params;
        const { timeline_limit: limitStr, timeline_offset: offsetStr } = request.query;
        const graph = graphEngine!.getGraph();
        
        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        const nodeData = graph.getNodeAttributes(id);
        const slimPerson = nodeData.data;
        
        // Read from pre-computed _computed cache (populated during hydration/hot-patch)
        const computed = nodeData._computed || {
            currentSpouse: null,
            siblings: [],
            children: [],
            allSpouses: []
        };

        // Lazy-load heavy fields from disk (Slim Node Strategy — spec 2.3B)
        const heavyFields = await graphEngine!.loadHeavyFields(id);

        // Pre-compute timeline feed (with optional pagination)
        let timeline: any;
        if (limitStr !== undefined || offsetStr !== undefined) {
            const limit = limitStr ? parseInt(limitStr, 10) : 50;
            const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

            if (isNaN(limit) || limit < 0 || limit > 200) {
                return reply.status(400).send({
                    error: 'timeline_limit must be between 0 and 200',
                    code: 'VALIDATION_ERROR'
                });
            }
            if (isNaN(offset) || offset < 0) {
                return reply.status(400).send({
                    error: 'timeline_offset must be >= 0',
                    code: 'VALIDATION_ERROR'
                });
            }

            timeline = sliceTimeline(graph, id, { limit, offset });
        } else {
            timeline = sliceTimeline(graph, id);
        }

        return {
            ...slimPerson,
            scrapbook_md: heavyFields?.scrapbook_md ?? '',
            _gedcom: heavyFields?._gedcom,
            _computed: computed,
            timeline
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

            // Write to file system via TransactionManager (queued for git commit)
            const relativePath = path.join('people', `${newPerson.id}.yaml`);
            const primaryName = newPerson.names[0];
            const label = `${primaryName.first} ${primaryName.last}`;
            await txManager!.writeFile(relativePath, yaml.dump(newPerson), label);

            // Add slim data to graph (Slim Node Strategy)
            const graph = graphEngine!.getGraph();
            graph.addNode(newPerson.id, { type: 'person', data: toSlimPerson(newPerson) });

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

            // Write to file system via TransactionManager (queued for git commit)
            const relativePath = path.join('people', `${id}.yaml`);
            const primaryName = updates.names?.[0];
            const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
            await txManager!.writeFile(relativePath, yaml.dump(updates), label);

            // Update graph with slim data (Slim Node Strategy)
            graph.setNodeAttribute(id, 'data', toSlimPerson(updates));

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

            // Track the uploaded asset for git staging
            await txManager!.trackFile(path.join('assets', uniqueFilename), `asset ${uniqueFilename}`);

            // Read full person data from disk (graph only stores slim data)
            const heavyFields = await graphEngine!.loadHeavyFields(id);
            const slimData = graph.getNodeAttributes(id).data;
            
            // Reconstruct full Person for YAML write
            const fullPerson: Person = {
                ...slimData,
                scrapbook_md: heavyFields?.scrapbook_md ?? '',
                _gedcom: heavyFields?._gedcom,
            } as Person;
            
            if (!fullPerson.assets.includes(uniqueFilename)) {
                fullPerson.assets.push(uniqueFilename);
            }
            
            // Update last_modified
            fullPerson.last_modified = new Date().toISOString();
            
            // Write updated person YAML via TransactionManager
            const personRelPath = path.join('people', `${id}.yaml`);
            const primaryName = fullPerson.names?.[0];
            const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
            await txManager!.writeFile(personRelPath, yaml.dump(fullPerson), label);
            
            // Update graph with slim data
            graph.setNodeAttribute(id, 'data', toSlimPerson(fullPerson));

            return {
                filename: uniqueFilename,
                assets: fullPerson.assets
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

            // Write all imported people via TransactionManager
            for (const person of result.people) {
                const relativePath = path.join('people', `${person.id}.yaml`);
                const primaryName = person.names?.[0];
                const label = primaryName ? `${primaryName.first} ${primaryName.last}` : person.id;
                await txManager!.writeFile(relativePath, yaml.dump(person), label);
            }

            // Flush all pending writes immediately for bulk import
            await txManager!.flush();

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

    // Force Re-hydration (bypasses tiered cache)
    server.post('/api/system/rebuild', async (request, reply) => {
        try {
            await graphEngine!.hydrate({ forceFullRebuild: true });
            
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
            // Flush pending commits before creating the tag
            if (txManager?.hasPending()) {
                await txManager.flush();
            }
            
            // Check if git repo exists
            const gitDir = path.join(config.dataDir, '.git');
            try {
                await fs.access(gitDir);
            } catch {
                return reply.status(500).send({
                    error: 'Not a git repository',
                    code: 'NOT_GIT_REPO'
                });
            }

            // Check if there are any commits
            try {
                await git.log({ fs: nodeFs, dir: config.dataDir, depth: 1 });
            } catch (err) {
                // No commits yet - make an initial one
                try {
                    const gitignorePath = path.join(config.dataDir, '.gitignore');
                    await fs.writeFile(gitignorePath, '# LegacyGraph\n');
                    await git.add({ fs: nodeFs, dir: config.dataDir, filepath: '.gitignore' });
                    await git.commit({
                        fs: nodeFs,
                        dir: config.dataDir,
                        message: 'Initial commit',
                        author: { name: 'LegacyGraph', email: 'legacygraph@localhost' }
                    });
                } catch (commitErr) {
                    // Ignore if already exists
                }
            }

            // Create annotated tag via isomorphic-git
            await git.annotatedTag({
                fs: nodeFs,
                dir: config.dataDir,
                ref: name,
                message: `Snapshot: ${name}`,
                tagger: {
                    name: 'LegacyGraph',
                    email: 'legacygraph@localhost'
                }
            });

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
