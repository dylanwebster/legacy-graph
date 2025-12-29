
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
});
