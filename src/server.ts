import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { GraphEngine } from './core/GraphEngine';
import { Person, PersonSchema } from './schemas/PersonSchema';
import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';

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

        // TODO: Implement actual git tagging via TransactionManager
        // For now, just return success
        return {
            tag: name,
            timestamp: new Date().toISOString()
        };
    });

    return server;
}

// Graceful shutdown
export async function closeServer(server: FastifyInstance): Promise<void> {
    await server.close();
    graphEngine = null;
}
