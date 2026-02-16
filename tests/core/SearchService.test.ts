
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
            { id: "E1", type: "birth", date: "1912", sort_date: "1912-06-23", location: "London", assets: [] },
            { id: "E2", type: "death", date: "1954", sort_date: "1954-06-07", location: "Wilmslow", assets: [], cause: "Cyanide" }
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
             { id: "E3", type: "education", date: "1928", sort_date: "1928-01-01", location: "Vassar College", assets: [], institution: "Vassar" }
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
                { id: "E4", type: "birth", date: "1815", sort_date: "1815-12-10", location: "London", assets: [] }
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
});
