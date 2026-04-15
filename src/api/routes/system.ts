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
                events.forEach((e: { type: string; partner_id?: string }) => {
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
        } catch (error: unknown) {
            console.error('[API] Rebuild error:', error);
            return reply.status(500).send({
                error: 'Failed to rebuild graph',
                code: 'REBUILD_ERROR',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    server.get('/api/graph', async () => {
        const graph = graphEngine.getGraph();
        const nodes: Array<{ id: string; label: string; sex: string; birthYear: number | null; deathYear: number | null; birthPlace: string | null; deathPlace: string | null; primaryAsset: string | null }> = [];
        const edgeSet = new Set<string>();
        const edges: Array<{ source: string; target: string; type: 'parent_child' | 'spouse'; status?: string }> = [];

        function extractYear(dateStr: string): number | null {
            const match = dateStr.match(/\b(\d{4})\b/);
            if (!match) return null;
            const yr = parseInt(match[1], 10);
            return yr > 999 && yr < 2200 ? yr : null;
        }

        function extractPlace(event: { location?: string | { name?: string; historicalName?: string } }): string | null {
            const loc = event?.location;
            if (!loc) return null;
            if (typeof loc === 'string') return loc || null;
            return (loc.historicalName ?? loc.name) || null;
        }

        graph.forEachNode((nodeId, attributes) => {
            if (attributes.type !== 'person') return;
            const p = attributes.data;
            const name = p.names?.[0];
            const label = name ? `${name.first ?? ''} ${name.last ?? ''}`.trim() : nodeId;
            const birthEvent = p.events?.find((e: { type: string }) => e.type === 'birth');
            const deathEvent = p.events?.find((e: { type: string }) => e.type === 'death');

            // Prefer sort_date (always ISO YYYY-MM-DD) over display date
            // which may be in GEDCOM format ("15 JAN 1920" → slice(0,4) = "15 J" → 15).
            const birthYear = birthEvent ? extractYear(birthEvent.sort_date || birthEvent.date || '') : null;
            const deathYear = deathEvent ? extractYear(deathEvent.sort_date || deathEvent.date || '') : null;
            const birthPlace = birthEvent ? extractPlace(birthEvent) : null;
            const deathPlace = deathEvent ? extractPlace(deathEvent) : null;

            nodes.push({
                id: nodeId,
                label,
                sex: p.sex ?? 'U',
                birthYear,
                deathYear,
                birthPlace,
                deathPlace,
                primaryAsset: p.assets?.[0] ?? null
            });

            // Parent-child edges: child → parent (only emit if both nodes exist in graph)
            const parents: Array<{ id: string }> = p.relationships?.parents ?? [];
            for (const parent of parents) {
                if (!graph.hasNode(parent.id)) continue;
                const key = `pc:${nodeId}:${parent.id}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: nodeId, target: parent.id, type: 'parent_child' });
                }
            }

            // Spouse edges from marriage events (deduplicated)
            const marriageEvents = (p.events ?? []).filter((e: { type: string; partner_id?: string }) => e.type === 'marriage' && e.partner_id);
            for (const ev of marriageEvents) {
                const [a, b] = [nodeId, ev.partner_id].sort();
                const key = `sp:${a}:${b}`;
                if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    edges.push({ source: a, target: b, type: 'spouse', status: ev.status ?? 'married' });
                }
            }
        });

        return { nodes, edges };
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
        } catch (error: unknown) {
            console.error('[API] Snapshot error:', error);
            return reply.status(500).send({
                error: 'Failed to create snapshot',
                code: 'SNAPSHOT_ERROR',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });
}
