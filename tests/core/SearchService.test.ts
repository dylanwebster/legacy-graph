
import { describe, it, expect, beforeEach } from 'vitest';
import Graph from 'graphology';
import { SearchService } from '../../src/core/SearchService';
import { Person } from '../../src/schemas/PersonSchema';

describe('SearchService', () => {
    let graph: Graph;
    let searchService: SearchService;

    const alan: Person = {
        version: "5.0",
        id: "N_ALAN",
        created: "2023-01-01T00:00:00Z",
        last_modified: "2023-01-01T00:00:00Z",
        names: [{ first: "Alan", last: "Turing", primary: true }],
        sex: "M",
        tags: ["mathematician", "war hero"],
        relationships: { parents: [] },
        events: [
            { id: "E1", type: "birth", date: "1912", sort_date: "1912-06-23", location: { name: "London" }, assets: [] },
            { id: "E2", type: "death", date: "1954", sort_date: "1954-06-07", location: { name: "Wilmslow" }, assets: [], cause: "Cyanide" }
        ],
        assets: [],
        scrapbook_md: "Father of theoretical computer science."
    };

    const grace: Person = {
        version: "5.0",
        id: "N_GRACE",
        created: "2023-01-01T00:00:00Z",
        last_modified: "2023-01-01T00:00:00Z",
        names: [{ first: "Grace", last: "Hopper", nickname: "Amazing Grace", primary: true }],
        sex: "F",
        tags: ["navy", "cobol"],
        relationships: { parents: [] },
        events: [
             { id: "E3", type: "education", date: "1928", sort_date: "1928-01-01", location: { name: "Vassar College" }, assets: [], institution: "Vassar" }
        ],
        assets: [],
        scrapbook_md: "Grand Lady of Software."
    };

    beforeEach(() => {
        graph = new Graph({ multi: true });
        searchService = new SearchService();

        // Populate Mock Graph
        graph.addNode(alan.id, { type: 'person', data: alan });
        graph.addNode(grace.id, { type: 'person', data: grace });
    });

    it('should index and find a person by name', async () => {
        await searchService.rebuild(graph);
        
        const results = await searchService.search("Turing");
        expect(results.people).toHaveLength(1);
        expect(results.people[0].id).toBe("N_ALAN");
        expect(results.people[0].name).toBe("Alan Turing");
    });

    it('should find a person by nickname', async () => {
        await searchService.rebuild(graph);
        
        const results = await searchService.search("Amazing");
        expect(results.people).toHaveLength(1);
        expect(results.people[0].id).toBe("N_GRACE");
    });

    it('should find a person by bio/scrapbook keywords', async () => {
        await searchService.rebuild(graph);
        
        // "theoretical" is in Alan's scrapbook
        const results = await searchService.search("theoretical");
        expect(results.people).toHaveLength(1);
        expect(results.people[0].id).toBe("N_ALAN");
    });

    it('should serialize location data into the index', async () => {
        await searchService.rebuild(graph);

        // "Wilmslow" is Alan's death location
        const results = await searchService.search("Wilmslow");
        expect(results.people).toHaveLength(1);
        expect(results.people[0].id).toBe("N_ALAN");
    });

    // --- Story Indexing Tests (Phase 3.5.6) ---

    it('should index and find stories by title', async () => {
        graph.addNode('bletchley-story.md', {
            type: 'story',
            data: {
                id: 'bletchley-story.md',
                metadata: { title: 'The Bletchley Park Story', tags: [], assets: [] },
                content: 'A story about codebreakers during WWII.',
                mentions: ['N_ALAN']
            }
        });

        await searchService.rebuild(graph);
        const results = await searchService.search("Bletchley");
        expect(results.stories).toHaveLength(1);
        expect(results.stories[0].id).toBe('bletchley-story.md');
        expect(results.stories[0].name).toBe('The Bletchley Park Story');
    });

    it('should index and find stories by content', async () => {
        graph.addNode('enigma-story.md', {
            type: 'story',
            data: {
                id: 'enigma-story.md',
                metadata: { title: 'War Memories', tags: [], assets: [] },
                content: 'Enigma machine decryption was crucial to the war effort.',
                mentions: []
            }
        });

        await searchService.rebuild(graph);
        const results = await searchService.search("Enigma");
        expect(results.stories).toHaveLength(1);
        expect(results.stories[0].id).toBe('enigma-story.md');
    });

    // --- Place Search Tests (Phase 3.5.6) ---

    it('should search places from event locations', async () => {
        await searchService.rebuild(graph);

        // "Vassar College" is Grace's education location
        const results = await searchService.search("Vassar");
        expect(results.places.length).toBeGreaterThanOrEqual(1);
        expect(results.places[0].location).toContain("Vassar");
    });

    it('should return place count reflecting number of people at that location', async () => {
        // Add another person with an event in London
        const ada: Person = {
            version: "5.0",
            id: "N_ADA",
            created: "2023-01-01T00:00:00Z",
            last_modified: "2023-01-01T00:00:00Z",
            names: [{ first: "Ada", last: "Lovelace", primary: true }],
            sex: "F",
            tags: [],
            relationships: { parents: [] },
            events: [
                { id: "E4", type: "birth", date: "1815", sort_date: "1815-12-10", location: { name: "London" }, assets: [] }
            ],
            assets: [],
            scrapbook_md: ""
        };
        graph.addNode(ada.id, { type: 'person', data: ada });

        await searchService.rebuild(graph);
        const results = await searchService.search("London");
        expect(results.places).toHaveLength(1);
        expect(results.places[0].location).toBe("London");
        expect(results.places[0].count).toBe(2); // Alan + Ada
    });

    // --- Hot-Patch Incremental Update Tests (Phase 3.5.6) ---

    it('should update search index when person name changes via indexPerson', async () => {
        await searchService.rebuild(graph);

        // Verify original name is searchable
        let results = await searchService.search("Turing");
        expect(results.people).toHaveLength(1);

        // Update Alan's last name
        const updatedAlan: Person = {
            ...alan,
            names: [{ first: "Alan", last: "Mathison", primary: true }]
        };
        searchService.indexPerson(updatedAlan);

        // Old name should NOT be found
        results = await searchService.search("Turing");
        expect(results.people).toHaveLength(0);

        // New name SHOULD be found
        results = await searchService.search("Mathison");
        expect(results.people).toHaveLength(1);
        expect(results.people[0].id).toBe("N_ALAN");
    });

    it('should remove person from search index and places', async () => {
        await searchService.rebuild(graph);

        let results = await searchService.search("Turing");
        expect(results.people).toHaveLength(1);

        searchService.removePerson("N_ALAN");

        results = await searchService.search("Turing");
        expect(results.people).toHaveLength(0);

        // Alan's unique location "Wilmslow" should also be gone from places
        results = await searchService.search("Wilmslow");
        expect(results.places).toHaveLength(0);
    });

    // --- Pagination Tests (Phase 3.6.3) ---

    it('should paginate search results with limit and offset', async () => {
        // Add more people so we have enough to paginate
        const people = [];
        for (let i = 0; i < 10; i++) {
            const person: Person = {
                version: "5.0",
                id: `N_P${i}`,
                created: "2023-01-01T00:00:00Z",
                last_modified: "2023-01-01T00:00:00Z",
                names: [{ first: `TestPerson`, last: `Number${i}`, primary: true }],
                sex: "U",
                tags: [],
                relationships: { parents: [] },
                events: [],
                assets: [],
                scrapbook_md: ""
            };
            people.push(person);
            graph.addNode(person.id, { type: 'person', data: person });
        }

        await searchService.rebuild(graph);

        // Search with limit=3 — should return only 3 results
        const results = await searchService.search("TestPerson", { limit: 3, offset: 0 });
        expect(results.people).toHaveLength(3);
        expect(results.totalCounts.people).toBe(10);
    });

    it('should apply offset correctly in pagination', async () => {
        // Add enough people
        for (let i = 0; i < 5; i++) {
            const person: Person = {
                version: "5.0",
                id: `N_OFF${i}`,
                created: "2023-01-01T00:00:00Z",
                last_modified: "2023-01-01T00:00:00Z",
                names: [{ first: `OffsetTest`, last: `Person${i}`, primary: true }],
                sex: "U",
                tags: [],
                relationships: { parents: [] },
                events: [],
                assets: [],
                scrapbook_md: ""
            };
            graph.addNode(person.id, { type: 'person', data: person });
        }

        await searchService.rebuild(graph);

        // Get all results
        const allResults = await searchService.search("OffsetTest", { limit: 100, offset: 0 });
        expect(allResults.people.length).toBe(5);

        // Offset beyond total → empty results
        const emptyResults = await searchService.search("OffsetTest", { limit: 10, offset: 100 });
        expect(emptyResults.people).toHaveLength(0);
        expect(emptyResults.totalCounts.people).toBe(5); // totalCounts still reflects full count

        // Offset=2, limit=2 → get items 2,3
        const pageResults = await searchService.search("OffsetTest", { limit: 2, offset: 2 });
        expect(pageResults.people).toHaveLength(2);
        expect(pageResults.totalCounts.people).toBe(5);
    });

    it('should return totalCounts even without pagination options (backward compatible)', async () => {
        await searchService.rebuild(graph);
        const results = await searchService.search("Turing");
        expect(results.totalCounts).toBeDefined();
        expect(results.totalCounts.people).toBe(1);
        expect(results.totalCounts.stories).toBe(0);
        expect(results.totalCounts.places).toBe(0);
    });

    // --- Performance Tests (Phase 3.8.4) ---

    it('trackedPersonIds uses Set semantics (O(1) add/has)', () => {
        // Verify internal tracking uses Set, not Array
        searchService.indexPerson(alan);
        searchService.indexPerson(grace);

        // Indexing the same person twice should not create duplicates
        searchService.indexPerson(alan);

        // Export to verify — tracked IDs should be deduplicated
        const service = searchService as any;
        const tracked = service.trackedPersonIds;
        expect(tracked instanceof Set).toBe(true);
        expect(tracked.size).toBe(2);
    });

    it('trackedStoryIds uses Set semantics (O(1) add/has)', () => {
        const story = {
            id: 'story-1.md',
            metadata: { title: 'Test', tags: [], assets: [] },
            content: 'content',
            mentions: []
        };

        searchService.indexStory(story as any);
        searchService.indexStory(story as any);

        const service = searchService as any;
        const tracked = service.trackedStoryIds;
        expect(tracked instanceof Set).toBe(true);
        expect(tracked.size).toBe(1);
    });

    it('search with FlexSearch limit bounds engine output', async () => {
        // Add 20 people with same first name
        for (let i = 0; i < 20; i++) {
            const person: Person = {
                version: "5.0",
                id: `N_PERF${i}`,
                created: "2023-01-01T00:00:00Z",
                last_modified: "2023-01-01T00:00:00Z",
                names: [{ first: `Perf`, last: `TestUser${i}`, primary: true }],
                sex: "U",
                tags: [],
                relationships: { parents: [] },
                events: [],
                assets: [],
                scrapbook_md: ""
            };
            graph.addNode(person.id, { type: 'person', data: person });
        }
        await searchService.rebuild(graph);

        // Request page 1 with limit=5
        const page1 = await searchService.search("Perf", { limit: 5, offset: 0 });
        expect(page1.people).toHaveLength(5);
        // totalCounts should reflect total matches, not just the page
        expect(page1.totalCounts.people).toBeGreaterThanOrEqual(5);
    });
});
