// src/core/TimelineSlicer.ts
import Graph from 'graphology';
import { Person } from '../schemas/PersonSchema';
import { LegacyEvent } from '../schemas/EventSchema';

export interface TimelineEvent {
    type: string; // Event type (birth, death, marriage, etc.)
    sort_date: string;
    data: LegacyEvent;
}

export interface TimelineStory {
    type: 'story';
    sort_date: string;
    id: string;
    title: string;
}

export interface TimelineGap {
    type: 'gap';
    years: number;
}

export type TimelineItem = TimelineEvent | TimelineStory | TimelineGap;

export interface TimelinePaginationOptions {
    limit?: number;
    offset?: number;
}

export interface PaginatedTimeline {
    items: TimelineItem[];
    totalCount: number;
    offset: number;
    limit: number;
}

/**
 * Pre-computes the "Integrated Feed" for the Person Detail page.
 *
 * 1. Collects all Person Events + Story Mentions
 * 2. Sorts by sort_date
 * 3. Inserts Gap objects when year difference > 10
 * 4. Optionally paginates with limit/offset
 *
 * When called without pagination options, returns a flat TimelineItem[] (backward compatible).
 * When called with pagination options, returns a PaginatedTimeline object.
 */
export function sliceTimeline(graph: Graph, personId: string): TimelineItem[];
export function sliceTimeline(graph: Graph, personId: string, options: TimelinePaginationOptions): PaginatedTimeline;
export function sliceTimeline(graph: Graph, personId: string, options?: TimelinePaginationOptions): TimelineItem[] | PaginatedTimeline {
    const emptyResult = options
        ? { items: [], totalCount: 0, offset: options.offset ?? 0, limit: options.limit ?? 0 }
        : [];

    if (!graph.hasNode(personId)) return emptyResult as any;

    const nodeAttr = graph.getNodeAttributes(personId);
    if (nodeAttr.type !== 'person') return emptyResult as any;

    const person = nodeAttr.data as Person;
    const sortable: Array<{ sort_date: string; item: TimelineEvent | TimelineStory }> = [];

    // 1. Collect Person Events
    for (const event of person.events) {
        sortable.push({
            sort_date: event.sort_date,
            item: {
                type: event.type,
                sort_date: event.sort_date,
                data: event
            }
        });
    }

    // 2. Collect Story Mentions (stories that mention this person via graph edges)
    const storyNeighbors = graph.inNeighbors(personId).filter(neighbor => {
        const nAttr = graph.getNodeAttributes(neighbor);
        if (nAttr.type !== 'story') return false;
        return graph.findOutEdge(neighbor, personId, (_key, attr) => attr.type === 'mentions');
    });

    for (const storyId of storyNeighbors) {
        const storyAttr = graph.getNodeAttributes(storyId);
        const storyData = storyAttr.data;
        const sortDate = storyData.sort_date || storyData.metadata?.date || '';
        if (!sortDate) continue; // Skip stories without dates

        sortable.push({
            sort_date: sortDate,
            item: {
                type: 'story',
                sort_date: sortDate,
                id: storyId,
                title: storyData.metadata?.title || storyId
            }
        });
    }

    if (sortable.length === 0) return emptyResult as any;

    // 3. Sort by sort_date
    sortable.sort((a, b) => a.sort_date.localeCompare(b.sort_date));

    // 4. Gap Detection — insert gaps when year difference > 10
    const allItems: TimelineItem[] = [sortable[0].item];

    for (let i = 1; i < sortable.length; i++) {
        const prevYear = extractYear(sortable[i - 1].sort_date);
        const currYear = extractYear(sortable[i].sort_date);

        if (prevYear !== null && currYear !== null) {
            const diff = currYear - prevYear;
            if (diff > 10) {
                allItems.push({ type: 'gap', years: diff });
            }
        }

        allItems.push(sortable[i].item);
    }

    // 5. Apply pagination if options provided
    if (options) {
        const limit = options.limit ?? allItems.length;
        const offset = options.offset ?? 0;
        return {
            items: allItems.slice(offset, offset + limit),
            totalCount: allItems.length,
            offset,
            limit
        };
    }

    return allItems;
}

/**
 * Extract the year from a sort_date string (YYYY-MM-DD or YYYY).
 */
function extractYear(sortDate: string): number | null {
    const match = sortDate.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
}
