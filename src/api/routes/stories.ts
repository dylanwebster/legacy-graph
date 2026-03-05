import { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as nodeFs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { pipeline } from 'stream/promises';
import { remark } from 'remark';
import { visit } from 'unist-util-visit';
import { StorySchema, StoryFeedItem, FullStory } from '../../schemas/StorySchema';
import type { AppInstance } from '../types';

/** Strip `.md` from a filename to get the API-facing story id. */
function filenameToId(filename: string): string {
    return filename.endsWith('.md') ? filename.slice(0, -3) : filename;
}

/** Parse @N_xxx and [[N_xxx]] mentions from Markdown body text. */
function extractMentions(content: string): string[] {
    const mentions = new Set<string>();
    remark().use(() => (tree) => {
        visit(tree, 'text', (node: any) => {
            const regex = /(@N_[a-zA-Z0-9_-]+)|(\[\[(N_[a-zA-Z0-9_-]+)\]\])/g;
            let match;
            while ((match = regex.exec(node.value)) !== null) {
                const id = match[1] || match[3];
                if (id) mentions.add(id.replace('@', ''));
            }
        });
    }).processSync(content);
    return Array.from(mentions);
}

/** Build a StoryFeedItem from raw story data. */
function toFeedItem(
    id: string,
    metadata: any,
    content: string,
    mentions: string[],
    resolvePersonName?: (personId: string) => string,
): StoryFeedItem {
    const people = Array.from(new Set([...(metadata.people ?? []), ...mentions]));
    // Replace @N_xxx / [[N_xxx]] with resolved person names (or strip if resolver unavailable)
    const bodyText = content
        .replace(/@N_[a-zA-Z0-9_-]+/g, (match) => {
            const personId = match.slice(1);
            return resolvePersonName ? resolvePersonName(personId) : '';
        })
        .replace(/\[\[N_[a-zA-Z0-9_-]+\]\]/g, (match) => {
            const personId = match.slice(2, -2);
            return resolvePersonName ? resolvePersonName(personId) : '';
        })
        .replace(/\s+/g, ' ')
        .trim();
    const excerpt = bodyText.length > 200 ? bodyText.slice(0, 200) : bodyText;
    return {
        id,
        title: metadata.title,
        date: metadata.date,
        place: metadata.place,
        people,
        excerpt,
        firstAsset: metadata.assets?.[0],
        private: metadata.private ?? false,
    };
}

/** Build a FullStory response from raw story data. */
function toFullStory(id: string, metadata: any, content: string, mentions: string[]): FullStory {
    return { id, metadata, content: content.replace(/^\n/, '').trimEnd(), mentions };
}

/** Write a story file to disk and return its parsed FullStory representation. */
async function writeStoryFile(
    id: string,
    metadata: Record<string, unknown>,
    content: string,
    writeFn: (relativePath: string, fileContent: string) => Promise<void>
): Promise<FullStory> {
    const parsed = StorySchema.parse(metadata);
    const fileContent = matter.stringify(content, parsed as any);
    await writeFn(path.join('stories', `${id}.md`), fileContent);
    const mentions = extractMentions(content);
    return toFullStory(id, parsed, content, mentions);
}

/** Build a person-name resolver from the in-memory graph. */
function makePersonNameResolver(graphEngine: AppInstance['appServices']['graphEngine']): (id: string) => string {
    const graph = graphEngine.getGraph();
    return (personId: string) => {
        const nodeAttrs = graph.hasNode(personId) ? graph.getNodeAttributes(personId) : null;
        const slim = nodeAttrs?.data as any;
        if (!slim?.names?.[0]) return personId;
        const n = slim.names[0];
        return [n.first, n.last].filter(Boolean).join(' ') || personId;
    };
}

export async function storiesRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;
    const storiesDir = path.join(dataDir, 'stories');

    // Ensure stories directory exists
    await fs.mkdir(storiesDir, { recursive: true });

    // ── GET /api/stories ──────────────────────────────────────────────────

    server.get<{
        Querystring: { limit?: string; offset?: string; sort?: string }
    }>('/api/stories', async (request, reply) => {
        const { limit: limitStr, offset: offsetStr, sort } = request.query;

        const limit = limitStr !== undefined ? parseInt(limitStr, 10) : 50;
        const offset = offsetStr !== undefined ? parseInt(offsetStr, 10) : 0;

        if (isNaN(limit) || limit < 0 || limit > 200) {
            return reply.status(400).send({ error: 'limit must be between 0 and 200', code: 'VALIDATION_ERROR' });
        }
        if (isNaN(offset) || offset < 0) {
            return reply.status(400).send({ error: 'offset must be >= 0', code: 'VALIDATION_ERROR' });
        }

        // Read all .md files from the stories directory
        let files: string[];
        try {
            files = (await fs.readdir(storiesDir)).filter(f => f.endsWith('.md'));
        } catch {
            files = [];
        }

        const resolvePersonName = makePersonNameResolver(graphEngine);
        const feedItems: StoryFeedItem[] = [];
        for (const file of files) {
            try {
                const raw = await fs.readFile(path.join(storiesDir, file), 'utf8');
                const { data, content } = matter(raw);
                const metadata = StorySchema.parse(data);
                const mentions = extractMentions(content);
                feedItems.push(toFeedItem(filenameToId(file), metadata, content, mentions, resolvePersonName));
            } catch {
                // Skip malformed story files
            }
        }

        // Sort: newest first by default (using date string), then oldest, then alphabetical
        if (sort === 'oldest') {
            feedItems.sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;  // undated goes last
                if (!b.date) return -1;
                return a.date.localeCompare(b.date);
            });
        } else if (sort === 'alpha') {
            feedItems.sort((a, b) => a.title.localeCompare(b.title));
        } else {
            // newest (default) — reverse chronological; undated go last
            feedItems.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
        }

        const totalCount = feedItems.length;
        return { stories: feedItems.slice(offset, offset + limit), totalCount };
    });

    // ── GET /api/stories/:id ──────────────────────────────────────────────

    server.get<{ Params: { id: string } }>('/api/stories/:id', async (request, reply) => {
        const { id } = request.params;
        const filePath = path.join(storiesDir, `${id}.md`);

        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const { data, content } = matter(raw);
            const metadata = StorySchema.parse(data);
            const mentions = extractMentions(content);
            return toFullStory(id, metadata, content, mentions);
        } catch {
            return reply.status(404).send({ error: 'Story not found', code: 'STORY_NOT_FOUND' });
        }
    });

    // ── POST /api/stories ─────────────────────────────────────────────────

    server.post<{
        Body: {
            title?: string;
            content?: string;
            date?: string;
            place?: string;
            people?: string[];
            tags?: string[];
            assets?: string[];
            private?: boolean;
        }
    }>('/api/stories', async (request, reply) => {
        const body = request.body;

        if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
            return reply.status(400).send({ error: 'title is required', code: 'VALIDATION_ERROR' });
        }

        // Generate a slug-like ID from title + nanoid
        const slug = body.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        const id = `${slug}-${nanoid(8)}`;

        const metadata: Record<string, unknown> = {
            title: body.title.trim(),
            ...(body.date !== undefined && { date: body.date }),
            ...(body.place !== undefined && { place: body.place }),
            ...(body.people !== undefined && { people: body.people }),
            ...(body.tags !== undefined && { tags: body.tags }),
            ...(body.private !== undefined && { private: body.private }),
            assets: body.assets ?? [],
        };

        const content = body.content ?? '';

        try {
            const story = await writeStoryFile(id, metadata, content,
                (rel, fc) => txManager.writeFile(rel, fc, `story ${id}`));
            await graphEngine.applyStoryWriteSideEffects(path.join(dataDir, 'stories', `${id}.md`));
            return reply.status(201).send(story);
        } catch (error: any) {
            return reply.status(400).send({ error: 'Invalid story data', code: 'VALIDATION_ERROR', details: error.message });
        }
    });

    // ── PUT /api/stories/:id ──────────────────────────────────────────────

    server.put<{
        Params: { id: string };
        Body: {
            title?: string;
            content?: string;
            date?: string;
            place?: string;
            people?: string[];
            tags?: string[];
            assets?: string[];
            private?: boolean;
        }
    }>('/api/stories/:id', async (request, reply) => {
        const { id } = request.params;
        const body = request.body;
        const filePath = path.join(storiesDir, `${id}.md`);

        // Load existing
        let existing: { data: Record<string, unknown>; content: string };
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const parsed = matter(raw);
            existing = { data: parsed.data, content: parsed.content };
        } catch {
            return reply.status(404).send({ error: 'Story not found', code: 'STORY_NOT_FOUND' });
        }

        // Merge updates
        const metadata: Record<string, unknown> = {
            ...existing.data,
            ...(body.title !== undefined && { title: body.title }),
            ...(body.date !== undefined && { date: body.date }),
            ...(body.place !== undefined && { place: body.place }),
            ...(body.people !== undefined && { people: body.people }),
            ...(body.tags !== undefined && { tags: body.tags }),
            ...(body.assets !== undefined && { assets: body.assets }),
            ...(body.private !== undefined && { private: body.private }),
        };
        const content = body.content !== undefined ? body.content : existing.content;

        try {
            const story = await writeStoryFile(id, metadata, content,
                (rel, fc) => txManager.writeFile(rel, fc, `story ${id}`));
            await graphEngine.applyStoryWriteSideEffects(path.join(dataDir, 'stories', `${id}.md`));
            return reply.status(200).send(story);
        } catch (error: any) {
            return reply.status(400).send({ error: 'Invalid story data', code: 'VALIDATION_ERROR', details: error.message });
        }
    });

    // ── DELETE /api/stories/:id ───────────────────────────────────────────

    server.delete<{ Params: { id: string } }>('/api/stories/:id', async (request, reply) => {
        const { id } = request.params;
        const filePath = path.join(storiesDir, `${id}.md`);

        try {
            await fs.access(filePath);
        } catch {
            return reply.status(404).send({ error: 'Story not found', code: 'STORY_NOT_FOUND' });
        }

        await fs.unlink(filePath);
        await txManager.removeFile(path.join('stories', `${id}.md`), `story ${id}`);
        return reply.status(204).send();
    });

    // ── PUT /api/stories/:id/media ────────────────────────────────────────

    server.put<{ Params: { id: string } }>('/api/stories/:id/media', async (request, reply) => {
        const { id } = request.params;
        const filePath = path.join(storiesDir, `${id}.md`);

        // Verify story exists
        let existingRaw: string;
        try {
            existingRaw = await fs.readFile(filePath, 'utf8');
        } catch {
            return reply.status(404).send({ error: 'Story not found', code: 'STORY_NOT_FOUND' });
        }

        let data: any;
        try {
            data = await (request as any).file();
        } catch (err: any) {
            if (err?.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
                return reply.status(400).send({ error: 'Request must be multipart/form-data', code: 'VALIDATION_ERROR' });
            }
            throw err;
        }
        if (!data) {
            return reply.status(400).send({ error: 'No file uploaded', code: 'VALIDATION_ERROR' });
        }

        const assetsDir = path.join(dataDir, 'assets');
        await fs.mkdir(assetsDir, { recursive: true });

        const ext = path.extname(data.filename) || '.bin';
        const filename = `${nanoid(12)}${ext}`;
        const destPath = path.join(assetsDir, filename);

        await pipeline(data.file, nodeFs.createWriteStream(destPath));
        await txManager.trackFile(path.join('assets', filename), `asset ${filename}`);

        // Update story frontmatter to include the new asset
        const { data: frontmatter, content } = matter(existingRaw);
        const currentAssets: string[] = Array.isArray(frontmatter.assets) ? frontmatter.assets : [];
        const updatedMetadata = { ...frontmatter, assets: [...currentAssets, filename] };

        const story = await writeStoryFile(id, updatedMetadata, content,
            (rel, fc) => txManager.writeFile(rel, fc, `story ${id}`));
        await graphEngine.applyStoryWriteSideEffects(path.join(dataDir, 'stories', `${id}.md`));

        return reply.status(200).send(story);
    });
}
