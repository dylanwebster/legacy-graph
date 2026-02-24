import { describe, it, expect, beforeEach } from 'vitest';
import Graph from 'graphology';
import { sliceTimeline, TimelineItem } from '../../src/core/TimelineSlicer';
import { Person } from '../../src/schemas/PersonSchema';

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
    return {
        version: "5.0",
        id,
        names: [{ first: id, last: 'Test', primary: true }],
        sex: "U",
        tags: [],
        relationships: { parents: [] },
        created: new Date().toISOString(),
        last_modified: new Date().toISOString(),
        assets: [],
        scrapbook_md: "",
        events: [],
        ...overrides
    };
}

describe('TimelineSlicer', () => {
    let graph: Graph;

    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
    });

    it('should return events sorted by sort_date', () => {
        const person = makePerson('N_p1', {
            events: [
                { id: 'e2', type: 'death', date: '1960', sort_date: '1960-01-01', assets: [] } as any,
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
                { id: 'e3', type: 'residence', date: '1930', sort_date: '1930-06-15', assets: [] } as any,
            ]
        });
        graph.addNode('N_p1', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_p1');

        // Filter out gaps to check event ordering
        const events = timeline.filter(item => item.type !== 'gap');
        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('birth');
        expect(events[1].type).toBe('residence');
        expect(events[2].type).toBe('death');
    });

    it('should merge story mentions into the timeline', () => {
        const person = makePerson('N_p1', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
            ]
        });
        graph.addNode('N_p1', { type: 'person', data: person });

        // Story that mentions this person
        graph.addNode('story1', {
            type: 'story',
            data: {
                id: 'story1',
                metadata: { title: 'War Diary', date: '1920', tags: [], assets: [] },
                mentions: ['N_p1'],
                sort_date: '1920-01-01'
            }
        });
        graph.addEdge('story1', 'N_p1', { type: 'mentions' });

        const timeline = sliceTimeline(graph, 'N_p1');
        const nonGapItems = timeline.filter(item => item.type !== 'gap');

        expect(nonGapItems).toHaveLength(2);
        expect(nonGapItems[0].type).toBe('birth');
        expect(nonGapItems[1].type).toBe('story');
    });

    it('should insert gap when year difference exceeds 10', () => {
        const person = makePerson('N_p1', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
                { id: 'e2', type: 'death', date: '1980', sort_date: '1980-05-15', assets: [] } as any,
            ]
        });
        graph.addNode('N_p1', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_p1');

        // Should have: birth, gap, death
        expect(timeline).toHaveLength(3);
        expect(timeline[0].type).toBe('birth');
        expect(timeline[1].type).toBe('gap');
        expect((timeline[1] as any).years).toBe(80); // 1980 - 1900
        expect(timeline[2].type).toBe('death');
    });

    it('should NOT insert gap when year difference is 10 or less', () => {
        const person = makePerson('N_p1', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
                { id: 'e2', type: 'residence', date: '1908', sort_date: '1908-06-01', assets: [] } as any,
                { id: 'e3', type: 'marriage', date: '1910', sort_date: '1910-03-15', partner_id: 'N_x', status: 'married', assets: [] } as any,
            ]
        });
        graph.addNode('N_p1', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_p1');

        // No gaps — all events within 10 years of each other
        const gaps = timeline.filter(item => item.type === 'gap');
        expect(gaps).toHaveLength(0);
        expect(timeline).toHaveLength(3);
    });

    it('should return empty array for non-existent person', () => {
        const timeline = sliceTimeline(graph, 'N_nonexistent');
        expect(timeline).toEqual([]);
    });

    it('should return empty array for person with no events', () => {
        const person = makePerson('N_empty');
        graph.addNode('N_empty', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_empty');
        expect(timeline).toEqual([]);
    });

    it('should handle multiple gaps in a single timeline', () => {
        const person = makePerson('N_p1', {
            events: [
                { id: 'e1', type: 'birth', date: '1800', sort_date: '1800-01-01', assets: [] } as any,
                { id: 'e2', type: 'residence', date: '1830', sort_date: '1830-06-01', assets: [] } as any,
                { id: 'e3', type: 'death', date: '1880', sort_date: '1880-12-31', assets: [] } as any,
            ]
        });
        graph.addNode('N_p1', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_p1');

        // birth -> gap(30yr) -> residence -> gap(50yr) -> death
        expect(timeline).toHaveLength(5);
        expect(timeline[0].type).toBe('birth');
        expect(timeline[1].type).toBe('gap');
        expect((timeline[1] as any).years).toBe(30);
        expect(timeline[2].type).toBe('residence');
        expect(timeline[3].type).toBe('gap');
        expect((timeline[3] as any).years).toBe(50);
        expect(timeline[4].type).toBe('death');
    });

    // --- Pagination Tests (Phase 3.6.3) ---

    it('should return paginated results with totalCount', () => {
        const person = makePerson('N_paged', {
            events: [
                { id: 'e1', type: 'birth', date: '1800', sort_date: '1800-01-01', assets: [] } as any,
                { id: 'e2', type: 'residence', date: '1830', sort_date: '1830-06-01', assets: [] } as any,
                { id: 'e3', type: 'death', date: '1880', sort_date: '1880-12-31', assets: [] } as any,
            ]
        });
        graph.addNode('N_paged', { type: 'person', data: person });

        // Full timeline has 5 items: birth, gap, residence, gap, death
        const full = sliceTimeline(graph, 'N_paged');
        expect(full).toHaveLength(5);

        // Paginate: limit=2, offset=0 → first 2 items
        const page1 = sliceTimeline(graph, 'N_paged', { limit: 2, offset: 0 });
        expect(page1.items).toHaveLength(2);
        expect(page1.totalCount).toBe(5);
        expect(page1.offset).toBe(0);
        expect(page1.limit).toBe(2);
        expect(page1.items[0].type).toBe('birth');
        expect(page1.items[1].type).toBe('gap');
    });

    it('should handle offset beyond totalCount', () => {
        const person = makePerson('N_off', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
            ]
        });
        graph.addNode('N_off', { type: 'person', data: person });

        const result = sliceTimeline(graph, 'N_off', { limit: 10, offset: 100 });
        expect(result.items).toHaveLength(0);
        expect(result.totalCount).toBe(1);
    });

    it('should return all items when no pagination options are provided (backward compat)', () => {
        const person = makePerson('N_compat', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
                { id: 'e2', type: 'death', date: '1960', sort_date: '1960-01-01', assets: [] } as any,
            ]
        });
        graph.addNode('N_compat', { type: 'person', data: person });

        // Without pagination options, sliceTimeline returns all items as a flat array (backward compat)
        const result = sliceTimeline(graph, 'N_compat');
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(3); // birth, gap, death
    });

    // --- Undated events (Phase 4 fix) ---

    it('should include events without sort_date at the TOP of the timeline with a header', () => {
        const person = makePerson('N_undated', {
            events: [
                { id: 'e1', type: 'birth', date: '1900', sort_date: '1900-01-01', assets: [] } as any,
                { id: 'e2', type: 'marriage', date: 'around 1925', sort_date: null, partner_id: 'N_x', status: 'married', assets: [] } as any,
                { id: 'e3', type: 'generic', date: '', sort_date: null, assets: [] } as any,
            ]
        });
        graph.addNode('N_undated', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_undated');
        // Should have: unknown_date_header, marriage, generic, birth (undated first, then dated)
        expect(timeline[0].type).toBe('unknown_date_header'); // header separator
        expect(timeline[1].type).toBe('marriage');            // undated — at top
        expect(timeline[2].type).toBe('generic');             // undated — at top
        expect(timeline[3].type).toBe('birth');               // dated — after undated section
    });

    it('should return timeline for a person with only undated events (with header)', () => {
        const person = makePerson('N_nodates', {
            events: [
                { id: 'e1', type: 'generic', date: 'sometime', sort_date: null, assets: [] } as any,
            ]
        });
        graph.addNode('N_nodates', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_nodates');
        // Header + the undated event
        expect(timeline).toHaveLength(2);
        expect(timeline[0].type).toBe('unknown_date_header');
        expect(timeline[1].type).toBe('generic');
    });

    // --- Derive sort_date from date field ---

    it('should sort events with ISO date but no sort_date chronologically', () => {
        const person = makePerson('N_iso', {
            events: [
                // Inserted out of order — no sort_date, but date is ISO
                { id: 'e2', type: 'death', date: '1980-03-15', assets: [] } as any,
                { id: 'e1', type: 'birth', date: '1920-06-01', assets: [] } as any,
            ]
        });
        graph.addNode('N_iso', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_iso');
        const nonGapItems = timeline.filter(i => i.type !== 'gap');
        expect(nonGapItems).toHaveLength(2);
        expect(nonGapItems[0].type).toBe('birth');  // 1920 first
        expect(nonGapItems[1].type).toBe('death');  // 1980 second
    });

    it('should sort events with bare-year date but no sort_date chronologically', () => {
        const person = makePerson('N_year', {
            events: [
                { id: 'e3', type: 'occupation', date: '1945', assets: [] } as any,
                { id: 'e1', type: 'birth', date: '1900', assets: [] } as any,
                { id: 'e2', type: 'marriage', date: '1925', partner_id: 'N_x', status: 'married', assets: [] } as any,
            ]
        });
        graph.addNode('N_year', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_year');
        const nonGapItems = timeline.filter(i => i.type !== 'gap');
        expect(nonGapItems).toHaveLength(3);
        expect(nonGapItems[0].type).toBe('birth');
        expect(nonGapItems[1].type).toBe('marriage');
        expect(nonGapItems[2].type).toBe('occupation');
    });

    it('should put events with unparseable date at the TOP, before sorted events', () => {
        const person = makePerson('N_mixed', {
            events: [
                { id: 'e3', type: 'generic', date: 'unknown time', assets: [] } as any,
                { id: 'e1', type: 'birth', date: '1900', assets: [] } as any,
                { id: 'e2', type: 'death', date: '1980', assets: [] } as any,
            ]
        });
        graph.addNode('N_mixed', { type: 'person', data: person });

        const timeline = sliceTimeline(graph, 'N_mixed');
        // Should be: header, generic (undated), birth, gap, death
        expect(timeline[0].type).toBe('unknown_date_header');
        expect(timeline[1].type).toBe('generic'); // unparseable — at top under header
        const nonHeaderOrGap = timeline.filter(i => i.type !== 'unknown_date_header' && i.type !== 'gap');
        expect(nonHeaderOrGap[0].type).toBe('generic');
        expect(nonHeaderOrGap[1].type).toBe('birth');
        expect(nonHeaderOrGap[2].type).toBe('death');
    });
});
