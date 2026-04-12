import { FastifyInstance } from 'fastify';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { AppInstance } from '../types';
import type { Place } from '../../schemas/PlaceSchema';
import type { SlimPerson } from '../../schemas/PersonSchema';
import { PersonSchema, toSlimPerson } from '../../schemas/PersonSchema';

interface BatchGeocodeOccurrence {
    personId: string;
    personName: string;
    eventId: string;
    eventType: string;
}

interface BatchGeocodeResult {
    locationString: string;
    occurrences: BatchGeocodeOccurrence[];
    match: {
        place: Place;
        confidence: 'high' | 'medium' | 'low';
        siteName: string | null;
    } | null;
}

interface BatchGeocodeStats {
    total: number;
    high: number;
    medium: number;
    low: number;
    unmatched: number;
    alreadyResolved: number;
}

interface ApplyUpdate {
    locationString: string;
    place: Place;
    siteName: string | null;
}

export async function geocodingRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, geocodingService } = (server as AppInstance).appServices;

    // POST /api/geocoding/batch — scan all people for unresolved locations and geocode them
    server.post('/api/geocoding/batch', async (_request, reply) => {
        const graph = graphEngine.getGraph();

        // Collect all unresolved locations with their occurrences
        const locationMap = new Map<string, BatchGeocodeOccurrence[]>();
        let alreadyResolved = 0;

        graph.forEachNode((nodeId, attributes) => {
            if (attributes.type !== 'person') return;
            const slim = attributes.data as SlimPerson;
            if (!slim.events) return;

            const primaryName = slim.names?.[0];
            const personName = primaryName
                ? [primaryName.first, primaryName.last].filter(Boolean).join(' ')
                : nodeId;

            for (const event of slim.events) {
                if (!event.location) continue;

                // Skip already-geocoded locations
                if (event.location.resolvedAt) {
                    alreadyResolved++;
                    continue;
                }

                const locStr = event.location.name;
                if (!locStr || !locStr.trim()) continue;

                const occurrences = locationMap.get(locStr) || [];
                occurrences.push({
                    personId: nodeId,
                    personName,
                    eventId: event.id,
                    eventType: event.type,
                });
                locationMap.set(locStr, occurrences);
            }
        });

        // Geocode each unique location string
        const results: BatchGeocodeResult[] = [];
        const stats: BatchGeocodeStats = {
            total: locationMap.size,
            high: 0,
            medium: 0,
            low: 0,
            unmatched: 0,
            alreadyResolved,
        };

        for (const [locStr, occurrences] of locationMap) {
            const searchResult = await geocodingService.searchWithMetadata(locStr);

            if (!searchResult.place || searchResult.confidence === 'none') {
                stats.unmatched++;
                results.push({
                    locationString: locStr,
                    occurrences,
                    match: null,
                });
            } else {
                const conf = searchResult.confidence;
                stats[conf]++;

                const siteName = searchResult.droppedParts.length > 0
                    ? searchResult.droppedParts.join(', ')
                    : null;

                results.push({
                    locationString: locStr,
                    occurrences,
                    match: {
                        place: searchResult.place,
                        confidence: conf,
                        siteName,
                    },
                });
            }
        }

        return { results, stats };
    });

    // POST /api/geocoding/batch/apply — apply confirmed geocoding results
    server.post<{ Body: { updates: ApplyUpdate[] } }>('/api/geocoding/batch/apply', async (request, reply) => {
        const { updates } = request.body ?? {};

        if (!updates || !Array.isArray(updates) || updates.length === 0) {
            return reply.status(400).send({
                error: 'Request body must include a non-empty "updates" array',
                code: 'VALIDATION_ERROR',
            });
        }

        const graph = graphEngine.getGraph();

        // Build lookup: locationString → update
        const updateMap = new Map<string, ApplyUpdate>();
        for (const u of updates) {
            updateMap.set(u.locationString, u);
        }

        // Find all people affected by these updates
        const affectedPeople = new Map<string, Set<string>>(); // personId → set of locationStrings
        graph.forEachNode((nodeId, attributes) => {
            if (attributes.type !== 'person') return;
            const slim = attributes.data as SlimPerson;
            if (!slim.events) return;

            for (const event of slim.events) {
                if (!event.location) continue;
                if (event.location.resolvedAt) continue;

                const locStr = event.location.name;
                if (updateMap.has(locStr)) {
                    const set = affectedPeople.get(nodeId) || new Set();
                    set.add(locStr);
                    affectedPeople.set(nodeId, set);
                }
            }
        });

        let updatedPeople = 0;
        let eventsUpdated = 0;

        for (const [personId, locationStrings] of affectedPeople) {
            const oldSlim = graph.getNodeAttributes(personId).data as SlimPerson;
            const heavyFields = await graphEngine.loadHeavyFields(personId);
            if (!heavyFields) continue;

            const currentPerson = {
                ...oldSlim,
                scrapbook_md: heavyFields.scrapbook_md ?? '',
                _gedcom: heavyFields._gedcom ?? {},
            };

            // Ensure original_locations bucket exists
            const gedcom = currentPerson._gedcom as Record<string, any>;
            if (!gedcom.original_locations) {
                gedcom.original_locations = {};
            }

            let personModified = false;

            for (const event of currentPerson.events) {
                if (!event.location) continue;
                if (event.location.resolvedAt) continue;

                const locStr = event.location.name;
                if (!locationStrings.has(locStr)) continue;

                const update = updateMap.get(locStr)!;

                // Preserve original location string
                (gedcom.original_locations as Record<string, string>)[event.id] = locStr;

                // Apply geocoded place
                event.location = update.place;

                // Set site_name if extracted and not already set
                if (update.siteName && !event.site_name) {
                    event.site_name = update.siteName;
                }

                personModified = true;
                eventsUpdated++;
            }

            if (personModified) {
                currentPerson.last_modified = new Date().toISOString();
                PersonSchema.parse(currentPerson);

                const relativePath = path.join('people', `${personId}.yaml`);
                const primaryName = currentPerson.names?.[0];
                const label = primaryName
                    ? `${primaryName.first} ${primaryName.last}`
                    : personId;
                await txManager.writeFile(relativePath, yaml.dump(currentPerson), label);

                const newSlim = toSlimPerson(currentPerson);
                graph.setNodeAttribute(personId, 'data', newSlim);
                graphEngine.applyWriteSideEffects(personId, oldSlim, newSlim, currentPerson.scrapbook_md || '');

                updatedPeople++;
            }
        }

        if (updatedPeople > 0) {
            await txManager.flush();
        }

        return { updated: updatedPeople, eventsUpdated };
    });
}
