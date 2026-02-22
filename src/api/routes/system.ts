import { FastifyInstance } from 'fastify';
import git from 'isomorphic-git';
import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AppInstance } from '../types';

export async function systemRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;

    server.get('/api/system/hydration/stream', async (request, reply) => {
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        if (graphEngine.hydrationState === 'ready') {
            const graph = graphEngine.getGraph();
            const data = JSON.stringify({
                nodeCount: graph.order,
                edgeCount: graph.size,
                elapsedMs: 0
            });
            reply.raw.write(`event: complete\ndata: ${data}\n\n`);
            reply.raw.end();
            return;
        }

        const onProgress = (progress: { phase: string; loaded: number; total: number; percent: number }) => {
            const data = JSON.stringify(progress);
            reply.raw.write(`event: progress\ndata: ${data}\n\n`);
        };

        const onComplete = (stats: { nodeCount: number; edgeCount: number; elapsedMs: number }) => {
            const data = JSON.stringify(stats);
            reply.raw.write(`event: complete\ndata: ${data}\n\n`);
            reply.raw.end();
            cleanup();
        };

        const onError = (err: Error) => {
            const data = JSON.stringify({ message: err.message });
            reply.raw.write(`event: error\ndata: ${data}\n\n`);
            reply.raw.end();
            cleanup();
        };

        const cleanup = () => {
            graphEngine.removeListener('hydration:progress', onProgress);
            graphEngine.removeListener('hydration:complete', onComplete);
            graphEngine.removeListener('hydration:error', onError);
        };

        graphEngine.on('hydration:progress', onProgress);
        graphEngine.on('hydration:complete', onComplete);
        graphEngine.on('hydration:error', onError);

        request.raw.on('close', cleanup);
    });

    server.get('/api/stats', async () => {
        const graph = graphEngine.getGraph();

        let totalPeople = 0;
        let lastModified = '1970-01-01T00:00:00.000Z';
        const familyPairs = new Set<string>();

        graph.forEachNode((nodeId, attributes) => {
            if (attributes.type === 'person') {
                totalPeople++;
                const person = attributes.data;
                if (person.last_modified && person.last_modified > lastModified) {
                    lastModified = person.last_modified;
                }

                const events = person.events || [];
                events.forEach((e: any) => {
                    if (e.type === 'marriage' && e.partner_id) {
                        const pair = [nodeId, e.partner_id].sort().join(':');
                        familyPairs.add(pair);
                    }
                });
            }
        });

        if (totalPeople === 0) {
            lastModified = new Date().toISOString();
        }

        return {
            totalPeople: totalPeople,
            totalFamilies: familyPairs.size,
            lastModified: lastModified
        };
    });

    server.get('/api/system/status', async () => {
        const graph = graphEngine.getGraph();
        return {
            nodeCount: graph.order,
            edgeCount: graph.size,
            hydrationState: graphEngine.hydrationState,
            cacheAge: graphEngine.cacheAge
        };
    });

    server.post('/api/system/rebuild', async (_request, reply) => {
        try {
            await graphEngine.hydrate({ forceFullRebuild: true });
            const graph = graphEngine.getGraph();
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
            if (txManager.hasPending()) {
                await txManager.flush();
            }

            const gitDir = path.join(dataDir, '.git');
            try {
                await fs.access(gitDir);
            } catch {
                return reply.status(500).send({
                    error: 'Not a git repository',
                    code: 'NOT_GIT_REPO'
                });
            }

            try {
                await git.log({ fs: nodeFs, dir: dataDir, depth: 1 });
            } catch {
                try {
                    const gitignorePath = path.join(dataDir, '.gitignore');
                    await fs.writeFile(gitignorePath, '# LegacyGraph\n');
                    await git.add({ fs: nodeFs, dir: dataDir, filepath: '.gitignore' });
                    await git.commit({
                        fs: nodeFs,
                        dir: dataDir,
                        message: 'Initial commit',
                        author: { name: 'LegacyGraph', email: 'legacygraph@localhost' }
                    });
                } catch {
                    // Ignore if already exists
                }
            }

            await git.annotatedTag({
                fs: nodeFs,
                dir: dataDir,
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
}
