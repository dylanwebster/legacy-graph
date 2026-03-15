import { FastifyInstance } from 'fastify';
import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { pipeline } from 'stream/promises';
import { AssetMetadataSchema, AssetIndexSchema } from '../../schemas/AssetSchema';
import { PersonSchema, toSlimPerson } from '../../schemas/PersonSchema';
import type { AppInstance } from '../types';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif', '.svg']);
const ALLOWED_EXTS = new Set([...IMAGE_EXTS, '.pdf', '.txt', '.md']);
const ALLOWED_MIME_PREFIXES = ['image/'];
const ALLOWED_MIMES = new Set(['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown']);

const isAllowedFile = (filename: string, mimetype: string) => {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) return false;
    if (IMAGE_EXTS.has(ext)) return ALLOWED_MIME_PREFIXES.some(p => mimetype.startsWith(p));
    return ALLOWED_MIMES.has(mimetype);
};

const MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
    '.heic': 'image/heic', '.heif': 'image/heif', '.tiff': 'image/tiff',
    '.tif': 'image/tiff', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/markdown',
};

function getMimeType(filename: string): string {
    return MIME_MAP[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

const META_REL = path.join('_meta', 'assets.yaml');

async function loadAssetIndex(dataDir: string): Promise<Record<string, any>> {
    try {
        const raw = await fs.readFile(path.join(dataDir, META_REL), 'utf8');
        return AssetIndexSchema.parse(yaml.load(raw) ?? {});
    } catch {
        return {};
    }
}

async function saveAssetIndex(dataDir: string, index: Record<string, any>, txManager: any): Promise<void> {
    await fs.mkdir(path.join(dataDir, '_meta'), { recursive: true });
    await txManager.writeFile(META_REL, yaml.dump(index), 'asset index');
}

export async function assetsRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;
    const assetsDir = path.join(dataDir, 'assets');
    const storiesDir = path.join(dataDir, 'stories');

    // ── GET /api/assets ──────────────────────────────────────────────────────

    server.get('/api/assets', async () => {
        await fs.mkdir(assetsDir, { recursive: true });

        let filenames: string[];
        try {
            filenames = (await fs.readdir(assetsDir)).filter(f => !f.startsWith('.'));
        } catch {
            filenames = [];
        }

        // Build person + event reference maps
        const personRefs = new Map<string, string[]>();
        const eventRefs = new Map<string, Array<{ personId: string; eventId: string; eventType: string }>>();
        const graph = graphEngine.getGraph();
        graph.forEachNode((_nodeId, attrs) => {
            if (attrs.type !== 'person') return;
            const person = attrs.data as any;
            const personId = person.id as string;
            if (Array.isArray(person.assets)) {
                for (const fn of person.assets) {
                    if (typeof fn !== 'string') continue;
                    if (!personRefs.has(fn)) personRefs.set(fn, []);
                    personRefs.get(fn)!.push(personId);
                }
            }
            if (Array.isArray(person.events)) {
                for (const event of person.events) {
                    if (!Array.isArray(event.assets)) continue;
                    for (const fn of event.assets) {
                        if (typeof fn !== 'string') continue;
                        if (!eventRefs.has(fn)) eventRefs.set(fn, []);
                        eventRefs.get(fn)!.push({ personId, eventId: event.id, eventType: event.type });
                    }
                }
            }
        });

        // Build story reference map
        const storyRefs = new Map<string, string[]>();
        try {
            const storyFiles = (await fs.readdir(storiesDir)).filter(f => f.endsWith('.md'));
            for (const file of storyFiles) {
                try {
                    const raw = await fs.readFile(path.join(storiesDir, file), 'utf8');
                    const { data } = matter(raw);
                    if (!Array.isArray(data.assets)) continue;
                    const storyId = file.slice(0, -3);
                    for (const a of data.assets) {
                        if (typeof a !== 'string') continue;
                        if (!storyRefs.has(a)) storyRefs.set(a, []);
                        storyRefs.get(a)!.push(storyId);
                    }
                } catch { /* skip malformed */ }
            }
        } catch { /* stories dir missing */ }

        const metaIndex = await loadAssetIndex(dataDir);

        const assets = await Promise.all(filenames.map(async (filename) => {
            let size = 0;
            try {
                const stat = await fs.stat(path.join(assetsDir, filename));
                size = stat.size;
            } catch { /* file disappeared */ }

            const people = personRefs.get(filename) ?? [];
            const stories = storyRefs.get(filename) ?? [];
            const events = eventRefs.get(filename) ?? [];

            const rawMeta = metaIndex[filename];
            const metadata = {
                caption: rawMeta?.caption as string | undefined,
                tagged_people: (rawMeta?.tagged_people ?? []) as string[],
            };

            return {
                filename,
                size,
                mimeType: getMimeType(filename),
                referencedBy: { people, stories, events },
                metadata,
                isOrphan: people.length === 0 && stories.length === 0 && events.length === 0,
            };
        }));

        return { assets, totalCount: assets.length };
    });

    // ── PUT /api/assets/:filename/meta ───────────────────────────────────────

    server.put<{
        Params: { filename: string };
        Body: { caption?: string; tagged_people?: string[] };
    }>('/api/assets/:filename/meta', async (request, reply) => {
        const { filename } = request.params;
        const { caption, tagged_people } = request.body;

        try {
            await fs.access(path.join(assetsDir, filename));
        } catch {
            return reply.status(404).send({ error: 'Asset not found', code: 'ASSET_NOT_FOUND' });
        }

        const index = await loadAssetIndex(dataDir);
        const existing = index[filename] ?? {};
        const merged = {
            ...existing,
            ...(caption !== undefined && { caption }),
            ...(tagged_people !== undefined && { tagged_people }),
        };

        index[filename] = AssetMetadataSchema.parse(merged);
        await saveAssetIndex(dataDir, index, txManager);

        return {
            caption: index[filename].caption,
            tagged_people: index[filename].tagged_people,
        };
    });

    // ── DELETE /api/assets/:filename ─────────────────────────────────────────

    server.delete<{ Params: { filename: string } }>('/api/assets/:filename', async (request, reply) => {
        const { filename } = request.params;
        const filePath = path.join(assetsDir, filename);

        try {
            await fs.access(filePath);
        } catch {
            return reply.status(404).send({ error: 'Asset not found', code: 'ASSET_NOT_FOUND' });
        }

        // Build refs for this file
        const people: string[] = [];
        const events: Array<{ personId: string; eventId: string; eventType: string }> = [];
        const graph = graphEngine.getGraph();
        graph.forEachNode((_nodeId, attrs) => {
            if (attrs.type !== 'person') return;
            const person = attrs.data as any;
            const personId = person.id as string;
            if (Array.isArray(person.assets) && person.assets.includes(filename)) {
                people.push(personId);
            }
            if (Array.isArray(person.events)) {
                for (const event of person.events) {
                    if (Array.isArray(event.assets) && event.assets.includes(filename)) {
                        events.push({ personId, eventId: event.id as string, eventType: event.type as string });
                    }
                }
            }
        });

        const stories: string[] = [];
        try {
            const storyFiles = (await fs.readdir(storiesDir)).filter(f => f.endsWith('.md'));
            for (const file of storyFiles) {
                try {
                    const raw = await fs.readFile(path.join(storiesDir, file), 'utf8');
                    const { data } = matter(raw);
                    if (Array.isArray(data.assets) && data.assets.includes(filename)) {
                        stories.push(file.slice(0, -3));
                    }
                } catch { /* skip */ }
            }
        } catch { /* ignore */ }

        if (people.length > 0 || stories.length > 0 || events.length > 0) {
            return reply.status(409).send({
                error: 'Asset is still referenced and cannot be deleted',
                code: 'ASSET_REFERENCED',
                referencedBy: { people, stories, events },
            });
        }

        await fs.unlink(filePath);
        await txManager.removeFile(path.join('assets', filename), `asset ${filename}`);

        const index = await loadAssetIndex(dataDir);
        if (Object.prototype.hasOwnProperty.call(index, filename)) {
            delete index[filename];
            await saveAssetIndex(dataDir, index, txManager);
        }

        return reply.status(204).send();
    });

    // ── PUT /api/people/:id/events/:eventId/media ────────────────────────────

    server.put<{ Params: { id: string; eventId: string } }>(
        '/api/people/:id/events/:eventId/media',
        async (request, reply) => {
            const { id, eventId } = request.params;
            const graph = graphEngine.getGraph();

            if (!graph.hasNode(id)) {
                return reply.status(404).send({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
            }

            const slimData = graph.getNodeAttributes(id).data as any;
            const events: any[] = slimData.events ?? [];
            const eventIdx = events.findIndex((e: any) => e.id === eventId);
            if (eventIdx === -1) {
                return reply.status(404).send({ error: 'Event not found', code: 'EVENT_NOT_FOUND' });
            }

            let fileData: any;
            try {
                fileData = await (request as any).file();
            } catch (err: any) {
                if (err?.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
                    return reply.status(400).send({ error: 'Request must be multipart/form-data', code: 'VALIDATION_ERROR' });
                }
                throw err;
            }
            if (!fileData) {
                return reply.status(400).send({ error: 'No file uploaded', code: 'VALIDATION_ERROR' });
            }

            if (!isAllowedFile(fileData.filename, fileData.mimetype)) {
                fileData.file.resume();
                return reply.status(415).send({ error: 'File type not allowed.', code: 'UNSUPPORTED_FILE_TYPE' });
            }

            await fs.mkdir(assetsDir, { recursive: true });

            const ext = path.extname(fileData.filename).toLowerCase();
            const rawBase = path.basename(fileData.filename, path.extname(fileData.filename))
                .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
            const baseName = rawBase || 'upload';

            let uniqueFilename = `${baseName}${ext}`;
            let counter = 1;
            while (true) {
                try {
                    await fs.access(path.join(assetsDir, uniqueFilename));
                    uniqueFilename = `${baseName}-${counter}${ext}`;
                    counter++;
                } catch { break; }
            }

            await pipeline(fileData.file, nodeFs.createWriteStream(path.join(assetsDir, uniqueFilename)));
            await txManager.trackFile(path.join('assets', uniqueFilename), `asset ${uniqueFilename}`);

            const heavyFields = await graphEngine.loadHeavyFields(id);
            const fullPerson = {
                ...slimData,
                scrapbook_md: heavyFields?.scrapbook_md ?? '',
                _gedcom: heavyFields?._gedcom,
            } as any;

            fullPerson.events = (fullPerson.events as any[]).map((e: any, i: number) =>
                i === eventIdx
                    ? { ...e, assets: [...(Array.isArray(e.assets) ? e.assets : []), uniqueFilename] }
                    : e
            );
            fullPerson.last_modified = new Date().toISOString();

            PersonSchema.parse(fullPerson);

            const primaryName = fullPerson.names?.[0];
            const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
            await txManager.writeFile(path.join('people', `${id}.yaml`), yaml.dump(fullPerson), label);

            const newSlim = toSlimPerson(fullPerson);
            graph.setNodeAttribute(id, 'data', newSlim);
            graphEngine.applyWriteSideEffects(id, slimData, newSlim, fullPerson.scrapbook_md || '');

            return { filename: uniqueFilename, events: fullPerson.events };
        }
    );

    // ── POST /api/people/:id/assets/link ─────────────────────────────────────

    server.post<{
        Params: { id: string };
        Body: { filename: string };
    }>('/api/people/:id/assets/link', async (request, reply) => {
        const { id } = request.params;
        const { filename } = request.body ?? {};
        const graph = graphEngine.getGraph();

        if (!graph.hasNode(id)) {
            return reply.status(404).send({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
        }

        if (!filename || typeof filename !== 'string') {
            return reply.status(400).send({ error: 'filename is required', code: 'VALIDATION_ERROR' });
        }

        try {
            await fs.access(path.join(assetsDir, filename));
        } catch {
            return reply.status(400).send({ error: 'Asset file not found on disk', code: 'ASSET_NOT_FOUND' });
        }

        const slimData = graph.getNodeAttributes(id).data as any;
        const heavyFields = await graphEngine.loadHeavyFields(id);
        const fullPerson = {
            ...slimData,
            scrapbook_md: heavyFields?.scrapbook_md ?? '',
            _gedcom: heavyFields?._gedcom,
        } as any;

        // Idempotent
        if ((fullPerson.assets as string[]).includes(filename)) {
            return { assets: fullPerson.assets };
        }

        fullPerson.assets = [...(fullPerson.assets as string[]), filename];
        fullPerson.last_modified = new Date().toISOString();

        PersonSchema.parse(fullPerson);

        const primaryName = fullPerson.names?.[0];
        const label = primaryName ? `${primaryName.first} ${primaryName.last}` : id;
        await txManager.writeFile(path.join('people', `${id}.yaml`), yaml.dump(fullPerson), label);

        const newSlim = toSlimPerson(fullPerson);
        graph.setNodeAttribute(id, 'data', newSlim);
        graphEngine.applyWriteSideEffects(id, slimData, newSlim, fullPerson.scrapbook_md || '');

        return { assets: fullPerson.assets };
    });
}
