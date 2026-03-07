import { FastifyInstance } from 'fastify';
import type { AppInstance } from '../types';

export async function searchRoutes(server: FastifyInstance) {
    const { graphEngine, geocodingService } = (server as AppInstance).appServices;

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
            const results = await graphEngine.searchService.search(q, { limit, offset });

            // Enrich person results with slim person data from the graph
            const graph = graphEngine.getGraph();

            // Helper to resolve @N_xxx IDs to display names for excerpts
            const resolvePersonName = (personId: string): string => {
                const nodeAttrs = graph.hasNode(personId) ? graph.getNodeAttributes(personId) : null;
                const slim = nodeAttrs?.data as any;
                if (!slim?.names?.[0]) return personId;
                const n = slim.names[0];
                return [n.first, n.last].filter(Boolean).join(' ') || personId;
            };
            const enrichedPeople = results.people.map((p) => {
                const nodeAttrs = graph.hasNode(p.id) ? graph.getNodeAttributes(p.id) : null;
                const slim = nodeAttrs?.data as any;
                if (!slim) {
                    return {
                        id: p.id,
                        names: [{ first: p.name }],
                        sex: 'U',
                        tags: [] as string[],
                        assetCount: 0,
                        primaryAsset: undefined as string | undefined,
                        last_modified: ''
                    };
                }
                return {
                    id: slim.id,
                    names: slim.names,
                    sex: slim.sex,
                    birthDate: slim.events?.find((e: any) => e.type === 'birth')?.sort_date as string | undefined,
                    deathDate: slim.events?.find((e: any) => e.type === 'death')?.date as string | undefined,
                    tags: slim.tags ?? [],
                    assetCount: slim.assets?.length ?? 0,
                    primaryAsset: slim.assets?.[0] as string | undefined,
                    last_modified: slim.last_modified ?? ''
                };
            });

            // Enrich story results with full StoryFeedItem data from the graph.
            // Story graph node IDs are filenames (e.g. "my-story-abc.md"),
            // but the API-facing story id strips .md.
            const enrichedStories = results.stories.map((s) => {
                // s.id from FlexSearch = the original story.id = filename (with .md)
                const nodeAttrs = graph.hasNode(s.id) ? graph.getNodeAttributes(s.id) : null;
                // API-facing id = strip .md
                const apiId = s.id.endsWith('.md') ? s.id.slice(0, -3) : s.id;
                const storyData = nodeAttrs?.data as any;
                if (!storyData) {
                    return { id: apiId, title: s.name, people: [] as string[], private: false, excerpt: s.snippet ?? '' };
                }
                const content: string = storyData.content ?? '';
                const bodyText = content
                    .replace(/@N_[a-zA-Z0-9_-]+/g, (match) => resolvePersonName(match.slice(1)))
                    .replace(/\[\[N_[a-zA-Z0-9_-]+\]\]/g, (match) => resolvePersonName(match.slice(2, -2)))
                    .replace(/\s+/g, ' ')
                    .trim();
                return {
                    id: apiId,
                    title: storyData.metadata?.title ?? s.name,
                    date: storyData.metadata?.date,
                    place: storyData.metadata?.place,
                    people: Array.from(new Set([
                        ...(storyData.metadata?.people ?? []),
                        ...(storyData.mentions ?? [])
                    ])) as string[],
                    excerpt: bodyText.length > 200 ? bodyText.slice(0, 200) : bodyText,
                    firstAsset: storyData.metadata?.assets?.[0],
                    private: storyData.metadata?.private ?? false,
                };
            });

            return {
                ...results,
                people: enrichedPeople,
                stories: enrichedStories,
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

    // GET /api/places/search?q=
    server.get<{ Querystring: { q?: string } }>('/api/places/search', async (request, reply) => {
        const { q } = request.query;
        if (!q || q.trim().length < 2) {
            return reply.status(400).send({
                error: 'Query parameter "q" must be at least 2 characters',
                code: 'VALIDATION_ERROR'
            });
        }
        const results = await geocodingService.search(q.trim(), 5);
        return results;
    });

    // POST /api/places/resolve
    server.post<{ Body: { name?: string } }>('/api/places/resolve', async (request, reply) => {
        const { name } = request.body ?? {};
        if (!name || !name.trim()) {
            return reply.status(400).send({
                error: 'Request body must include "name"',
                code: 'VALIDATION_ERROR'
            });
        }
        const result = await geocodingService.resolve(name.trim());
        return result;
    });
}
