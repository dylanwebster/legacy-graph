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

/**
 * Pre-computes the "Integrated Feed" for the Person Detail page.
 *
 * 1. Collects all Person Events + Story Mentions
 * 2. Sorts by sort_date
 * 3. Inserts Gap objects when year difference > 10
 */
export function sliceTimeline(graph: Graph, personId: string): TimelineItem[] {
    if (!graph.hasNode(personId)) return [];

    const nodeAttr = graph.getNodeAttributes(personId);
    if (nodeAttr.type !== 'person') return [];

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

    if (sortable.length === 0) return [];

    // 3. Sort by sort_date
    sortable.sort((a, b) => a.sort_date.localeCompare(b.sort_date));

    // 4. Gap Detection — insert gaps when year difference > 10
    const result: TimelineItem[] = [sortable[0].item];

    for (let i = 1; i < sortable.length; i++) {
        const prevYear = extractYear(sortable[i - 1].sort_date);
        const currYear = extractYear(sortable[i].sort_date);

        if (prevYear !== null && currYear !== null) {
            const diff = currYear - prevYear;
            if (diff > 10) {
                result.push({ type: 'gap', years: diff });
            }
        }

        result.push(sortable[i].item);
    }

    return result;
}

/**
 * Extract the year from a sort_date string (YYYY-MM-DD or YYYY).
 */
function extractYear(sortDate: string): number | null {
    const match = sortDate.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
}
