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

export interface TimelineUnknownDateHeader {
    type: 'unknown_date_header';
}

export type TimelineItem = TimelineEvent | TimelineStory | TimelineGap | TimelineUnknownDateHeader;

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
 * 2. Undated events appear at the TOP under an "unknown_date_header" separator
 * 3. Dated events are sorted by sort_date with gap indicators (>10 year gaps)
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
    const undated: Array<TimelineEvent | TimelineStory> = [];

    // 1. Collect Person Events — separate dated from undated
    for (const event of person.events) {
        const sd = effectiveSortDate(event);
        if (!sd) {
            // Events without a parseable date go to the top "Undated Events" section
            undated.push({ type: event.type, sort_date: '', data: event });
        } else {
            sortable.push({
                sort_date: sd,
                item: { type: event.type, sort_date: sd, data: event }
            });
        }
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
        const storyItem: TimelineStory = {
            type: 'story',
            sort_date: sortDate,
            id: storyId,
            title: storyData.metadata?.title || storyId
        };

        if (sortDate) {
            sortable.push({ sort_date: sortDate, item: storyItem });
        } else {
            undated.push(storyItem); // Show undated stories in undated section
        }
    }

    if (sortable.length === 0 && undated.length === 0) return emptyResult as any;

    // 3. Sort dated items by sort_date
    sortable.sort((a, b) => a.sort_date.localeCompare(b.sort_date));

    // 4. Gap Detection — insert gaps when year difference > 10 (dated events only)
    const datedItems: TimelineItem[] = sortable.length > 0 ? [sortable[0].item] : [];

    for (let i = 1; i < sortable.length; i++) {
        const prevYear = extractYear(sortable[i - 1].sort_date);
        const currYear = extractYear(sortable[i].sort_date);

        if (prevYear !== null && currYear !== null) {
            const diff = currYear - prevYear;
            if (diff > 10) {
                datedItems.push({ type: 'gap', years: diff });
            }
        }

        datedItems.push(sortable[i].item);
    }

    // 5. Prepend undated events at the top with a header separator
    const allItems: TimelineItem[] = [];
    if (undated.length > 0) {
        allItems.push({ type: 'unknown_date_header' });
        for (const undatedItem of undated) {
            allItems.push(undatedItem);
        }
    }
    for (const datedItem of datedItems) {
        allItems.push(datedItem);
    }

    // 6. Apply pagination if options provided
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

/**
 * Derive a sortable ISO date from an event, using sort_date if present, otherwise
 * attempting to parse the date field. Returns null if no sortable date can be derived.
 *
 * Handles:
 *   sort_date: "1950-06-15"  → "1950-06-15"  (verbatim)
 *   date: "1950-06-15"       → "1950-06-15"  (already ISO)
 *   date: "1950-06"          → "1950-06-01"  (partial ISO → first of month)
 *   date: "1950"             → "1950-01-01"  (bare year → first of year)
 */
function effectiveSortDate(event: LegacyEvent): string | null {
    if (event.sort_date) return event.sort_date;
    const d = event.date as string | undefined;
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
    if (/^\d{4}$/.test(d)) return `${d}-01-01`;
    return null;
}
