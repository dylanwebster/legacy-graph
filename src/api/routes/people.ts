import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { pipeline } from 'stream/promises';
import { Person, PersonSchema, SlimPerson, toSlimPerson } from '../../schemas/PersonSchema';
import { sliceTimeline } from '../../core/TimelineSlicer';
import { invalidateComputed } from '../../core/GraphLogic';
import type { AppInstance } from '../types';

export async function peopleRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;

    server.get<{
        Querystring: { limit?: string; offset?: string; sort?: string; order?: string }
    }>('/api/people', async (request, reply) => {
        const { limit: limitStr, offset: offsetStr, sort, order } = request.query;

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

        const graph = graphEngine.getGraph();
        const people: any[] = [];

        graph.forEachNode((nodeId, attributes) => {
            if (attributes.type === 'person') {
                const p = attributes.data;
                people.push({
                    id: p.id,
                    names: p.names,
                    sex: p.sex,
                    birthDate: p.events?.find((e: any) => e.type === 'birth')?.date,
                    deathDate: p.events?.find((e: any) => e.type === 'death')?.date,
                    tags: p.tags,
                    assetCount: p.assets?.length || 0,
                    last_modified: p.last_modified
                });
            }
        });

        const VALID_SORT_FIELDS = new Set(['last_modified', 'birthDate', 'deathDate', 'assetCount']);
        const sortBy = (sort && VALID_SORT_FIELDS.has(sort)) ? sort : 'last_modified';
        const sortOrder = (order === 'asc' || order === 'desc') ? (order === 'asc' ? 1 : -1) : -1;

        people.sort((a, b) => {
            const valA = a[sortBy] || '';
            const valB = b[sortBy] || '';
            if (valA < valB) return -1 * sortOrder;
            if (valA > valB) return 1 * sortOrder;
            return 0;
        });

        const totalCount = people.length;
        const paginatedPeople = people.slice(offset, offset + limit);

        return {
            people: paginatedPeople,
            totalCount
        };
    });

    server.get<{
        Params: { id: string },
        Querystring: { timeline_limit?: string; timeline_offset?: string }
    }>('/api/people/:id', async (request, reply) => {
        const { id } = request.params;
        const { timeline_limit: limitStr, timeline_offset: offsetStr } = request.query;
        const graph = graphEngine.getGraph();

        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        const nodeData = graph.getNodeAttributes(id);
        const slimPerson = nodeData.data;

        const computed = nodeData._computed || {
            currentSpouse: null,
            siblings: [],
            children: [],
            allSpouses: []
        };

        const heavyFields = await graphEngine.loadHeavyFields(id);

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

    server.post<{
        Body: Partial<Person>
    }>('/api/people', async (request, reply) => {
        const body = request.body;

        try {
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

            PersonSchema.parse(newPerson);

            const relativePath = path.join('people', `${newPerson.id}.yaml`);
            const primaryName = newPerson.names[0];
            const label = `${primaryName.first} ${primaryName.last}`;
            await txManager.writeFile(relativePath, yaml.dump(newPerson), label);

            const graph = graphEngine.getGraph();
            const slim = toSlimPerson(newPerson);
            graph.addNode(newPerson.id, { type: 'person', data: slim });

            graphEngine.applyWriteSideEffects(newPerson.id, null, slim, newPerson.scrapbook_md || '');

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

    server.put<{
        Params: { id: string },
        Body: Person
    }>('/api/people/:id', async (request, reply) => {
        const { id } = request.params;
        const updates = request.body;
        const graph = graphEngine.getGraph();

        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        try {
            const oldSlim = graph.getNodeAttributes(id).data as SlimPerson;

            updates.last_modified = new Date().toISOString();
            PersonSchema.parse(updates);

            const relativePath = path.join('people', `${id}.yaml`);
            const primaryName = updates.names?.[0];
            const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
            await txManager.writeFile(relativePath, yaml.dump(updates), label);

            const newSlim = toSlimPerson(updates);
            graph.setNodeAttribute(id, 'data', newSlim);

            graphEngine.applyWriteSideEffects(id, oldSlim, newSlim, updates.scrapbook_md || '');

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

    server.put<{
        Params: { id: string }
    }>('/api/people/:id/media', async (request, reply) => {
        const { id } = request.params;
        const graph = graphEngine.getGraph();

        if (!graph.hasNode(id)) {
            return reply.status(404).send({
                error: 'Person not found',
                code: 'PERSON_NOT_FOUND'
            });
        }

        try {
            const data = await request.file();

            if (!data) {
                return reply.status(400).send({
                    error: 'No file provided',
                    code: 'MISSING_FILE'
                });
            }

            const ext = path.extname(data.filename);
            const uniqueFilename = `${nanoid()}${ext}`;

            const assetsDir = path.join(dataDir, 'assets');
            await fs.mkdir(assetsDir, { recursive: true });

            const filepath = path.join(assetsDir, uniqueFilename);
            await pipeline(data.file, nodeFs.createWriteStream(filepath));

            await txManager.trackFile(path.join('assets', uniqueFilename), `asset ${uniqueFilename}`);

            const heavyFields = await graphEngine.loadHeavyFields(id);
            const slimData = graph.getNodeAttributes(id).data;

            const fullPerson: Person = {
                ...slimData,
                scrapbook_md: heavyFields?.scrapbook_md ?? '',
                _gedcom: heavyFields?._gedcom,
            } as Person;

            if (!fullPerson.assets.includes(uniqueFilename)) {
                fullPerson.assets.push(uniqueFilename);
            }

            fullPerson.last_modified = new Date().toISOString();

            const personRelPath = path.join('people', `${id}.yaml`);
            const primaryName = fullPerson.names?.[0];
            const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
            await txManager.writeFile(personRelPath, yaml.dump(fullPerson), label);

            graph.setNodeAttribute(id, 'data', toSlimPerson(fullPerson));
            invalidateComputed(graphEngine.getGraph(), id);

            return {
                filename: uniqueFilename,
                assets: fullPerson.assets
            };
        } catch (error: any) {
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
}
