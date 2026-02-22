import { FastifyInstance } from 'fastify';
import type { AppInstance } from '../types';

export async function searchRoutes(server: FastifyInstance) {
    const { graphEngine } = (server as AppInstance).appServices;

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
}
