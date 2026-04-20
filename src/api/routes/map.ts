import { FastifyInstance } from 'fastify';
import type { AppInstance } from '../types';
import type { SlimPerson } from '../../schemas/PersonSchema';
import type { LegacyEvent } from '../../schemas/EventSchema';
import { getLineage } from '../../core/GraphLogic';

interface MapEvent {
    id: string;
    person_id: string;
    person_name: string;
    type: string;
    lat: number;
    lng: number;
    sort_date: string | null;
    sort_end_date: string | null;
    has_assets: boolean;
    place_name: string;
}

interface MapEventsResponse {
    events: MapEvent[];
    extent: {
        minDate: string | null;
        maxDate: string | null;
        bbox: [number, number, number, number] | null;
    };
}

export async function mapRoutes(server: FastifyInstance) {
    const { graphEngine } = (server as AppInstance).appServices;

    server.get<{
        Querystring: { person?: string; lineage?: string };
    }>('/api/map/events', async (request, reply) => {
        const { person, lineage } = request.query;

        if (person && lineage) {
            return reply.status(400).send({
                error: 'Pass either ?person or ?lineage, not both',
                code: 'VALIDATION_ERROR',
            });
        }

        const graph = graphEngine.getGraph();

        let allowed: Set<string> | null = null;
        if (person) {
            if (!graph.hasNode(person)) {
                return reply.status(404).send({ error: 'Unknown person id', code: 'NOT_FOUND' });
            }
            allowed = new Set([person]);
        } else if (lineage) {
            if (!graph.hasNode(lineage)) {
                return reply.status(404).send({ error: 'Unknown person id', code: 'NOT_FOUND' });
            }
            allowed = getLineage(graph, lineage);
        }

        const events: MapEvent[] = [];
        let minDate: string | null = null;
        let maxDate: string | null = null;
        let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;

        graph.forEachNode((nodeId, attrs) => {
            if (attrs.type !== 'person') return;
            if (allowed && !allowed.has(nodeId)) return;

            const data = attrs.data as SlimPerson;
            const primary = data.names?.[0];
            const personName = primary ? [primary.first, primary.last].filter(Boolean).join(' ') || nodeId : nodeId;

            for (const raw of data.events) {
                const evt = raw as LegacyEvent;
                const loc = evt.location;
                if (!loc || typeof loc !== 'object') continue;
                if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;

                events.push({
                    id: evt.id,
                    person_id: nodeId,
                    person_name: personName,
                    type: evt.type,
                    lat: loc.lat,
                    lng: loc.lng,
                    sort_date: evt.sort_date ?? null,
                    sort_end_date: evt.sort_end_date ?? null,
                    has_assets: (evt.assets?.length ?? 0) > 0,
                    place_name: loc.name,
                });

                if (evt.sort_date) {
                    if (!minDate || evt.sort_date < minDate) minDate = evt.sort_date;
                    if (!maxDate || evt.sort_date > maxDate) maxDate = evt.sort_date;
                }
                if (evt.sort_end_date) {
                    if (!maxDate || evt.sort_end_date > maxDate) maxDate = evt.sort_end_date;
                }
                if (loc.lat < minLat) minLat = loc.lat;
                if (loc.lat > maxLat) maxLat = loc.lat;
                if (loc.lng < minLng) minLng = loc.lng;
                if (loc.lng > maxLng) maxLng = loc.lng;
            }
        });

        const response: MapEventsResponse = {
            events,
            extent: {
                minDate,
                maxDate,
                bbox: events.length > 0 ? [minLng, minLat, maxLng, maxLat] : null,
            },
        };
        return response;
    });
}
