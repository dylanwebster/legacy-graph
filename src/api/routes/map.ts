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

class LRU<K, V> {
    private m = new Map<K, V>();
    constructor(private max: number) {}
    get(k: K): V | undefined {
        const v = this.m.get(k);
        if (v === undefined) return undefined;
        this.m.delete(k);
        this.m.set(k, v);
        return v;
    }
    set(k: K, v: V): void {
        if (this.m.has(k)) {
            this.m.delete(k);
        } else if (this.m.size >= this.max) {
            const oldest = this.m.keys().next().value;
            if (oldest !== undefined) this.m.delete(oldest);
        }
        this.m.set(k, v);
    }
    clear(): void {
        this.m.clear();
    }
}

export async function mapRoutes(server: FastifyInstance) {
    const { graphEngine } = (server as AppInstance).appServices;
    const cache = new LRU<string, MapEventsResponse>(32);
    let gen = 0;
    const onGraphUpdated = () => {
        gen++;
        cache.clear();
    };
    graphEngine.on('graph-updated', onGraphUpdated);
    server.addHook('onClose', async () => {
        graphEngine.off('graph-updated', onGraphUpdated);
    });

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

        if (person && !graph.hasNode(person)) {
            return reply.status(404).send({ error: 'Unknown person id', code: 'NOT_FOUND' });
        }
        if (lineage && !graph.hasNode(lineage)) {
            return reply.status(404).send({ error: 'Unknown person id', code: 'NOT_FOUND' });
        }

        // Cache key matches §6.11's `${scope}:${focalPersonId ?? '_'}` shape.
        const cacheKey = lineage ? `lineage:${lineage}` : person ? `person:${person}` : 'all:_';
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        const myGen = gen;

        let allowed: Set<string> | null = null;
        if (person) {
            allowed = new Set([person]);
        } else if (lineage) {
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

        // Only memoize if no graph update raced us mid-computation.
        if (myGen === gen) cache.set(cacheKey, response);
        return response;
    });
}
