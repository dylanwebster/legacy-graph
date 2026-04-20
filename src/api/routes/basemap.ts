import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const DEFAULT_REMOTE_PMTILES = 'https://demo-bucket.protomaps.com/v4.pmtiles';

function resolveBasemapPath(): string {
    return process.env.PMTILES_PATH
        ?? path.join(os.homedir(), '.legacy-graph', 'basemap.pmtiles');
}

function resolveRemotePmtiles(): string {
    return process.env.PMTILES_REMOTE_URL ?? DEFAULT_REMOTE_PMTILES;
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
    try { return await fsp.stat(p); } catch { return null; }
}

export async function basemapRoutes(server: FastifyInstance) {
    server.get('/api/system/basemap', async () => {
        const file = resolveBasemapPath();
        const stat = await statOrNull(file);
        if (stat) {
            return {
                available: true,
                source: 'local' as const,
                path: file,
                sizeBytes: stat.size,
                builtAt: stat.mtime.toISOString(),
            };
        }
        // Fall back to a remote PMTiles URL read via HTTP range requests.
        return {
            available: true,
            source: 'remote' as const,
            remoteUrl: resolveRemotePmtiles(),
        };
    });

    // Stream the PMTiles file with HTTP Range request support.
    // MapLibre + the pmtiles client issue many small range requests to read
    // directory + tile slices out of a single file — we must honor Range.
    server.get('/api/basemap/tiles', async (request: FastifyRequest, reply: FastifyReply) => {
        const file = resolveBasemapPath();
        const stat = await statOrNull(file);
        if (!stat) {
            return reply.status(404).send({ error: 'Basemap not built', code: 'BASEMAP_MISSING' });
        }

        const range = request.headers.range;
        if (!range) {
            reply.header('Content-Type', 'application/octet-stream');
            reply.header('Content-Length', stat.size);
            reply.header('Accept-Ranges', 'bytes');
            return reply.send(fs.createReadStream(file));
        }

        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) {
            reply.header('Content-Range', `bytes */${stat.size}`);
            return reply.status(416).send({ error: 'Invalid Range header' });
        }
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        if (start > end || end >= stat.size) {
            reply.header('Content-Range', `bytes */${stat.size}`);
            return reply.status(416).send({ error: 'Range not satisfiable' });
        }
        reply.status(206);
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        reply.header('Content-Length', end - start + 1);
        reply.header('Accept-Ranges', 'bytes');
        return reply.send(fs.createReadStream(file, { start, end }));
    });
}
