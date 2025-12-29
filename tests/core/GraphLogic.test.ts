import { describe, it, expect, beforeEach } from 'vitest';
import Graph from 'graphology';
import { getAggregatedAssets, getCurrentSpouse } from '../../src/core/GraphLogic';
import { Person } from '../../src/schemas/PersonSchema';

describe('Graph Logic', () => {
    let graph: Graph;
    
    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
    });

    // --- ASSET PROPAGATION TEST (Transitive Logic) ---
    it('should aggregate assets from Person, Events, and Stories', () => {
        // 1. Person with direct asset + event asset
        const person: Person = {
            version: "5.0", id: "P1", names: [], sex: "M", tags: [], relationships: {parents:[]}, created:"", last_modified:"",
            assets: ["direct.jpg"],
            events: [
                { id: "e1", type: "birth", date: "1900", sort_date: "1900", assets: ["birth.jpg"] } as any
            ]
        };
        graph.addNode("P1", { type: 'person', data: person });

        // 2. Story with asset mentioning Person
        graph.addNode("story.md", { 
            type: 'story', 
            data: { 
                id: "story.md", 
                metadata: { assets: ["story.jpg"], tags: [], title: "" }, 
                mentions: ["P1"] 
            } 
        });
        graph.addEdge("story.md", "P1", { type: 'mentions' });

        const results = getAggregatedAssets(graph, "P1");
        expect(results).toContain("direct.jpg"); // From P1
        expect(results).toContain("birth.jpg");  // From P1.events
        expect(results).toContain("story.jpg");  // From Story -> P1
    });

    // --- SPOUSE TEST (Henry VIII Logic) ---
    it('should determine correct spouse from events', () => {
        const henry: Person = {
            version: "5.0", id: "HENRY", names: [], sex: "M", tags: [], relationships: {parents:[]}, created:"", last_modified:"", assets:[],
            events: [
                { id: "e1", type: "marriage", date: "1509", sort_date: "1509", partner_id: "CATH", status: "married" },
                { id: "e2", type: "divorce", date: "1533", sort_date: "1533", partner_id: "CATH" },
                { id: "e3", type: "marriage", date: "1533", sort_date: "1533-05", partner_id: "ANNE", status: "married" }
            ] as any
        };
        graph.addNode("HENRY", { type: 'person', data: henry });
        graph.addNode("CATH", { type: 'person', data: { ...henry, id: "CATH", events: [] } });
        graph.addNode("ANNE", { type: 'person', data: { ...henry, id: "ANNE", events: [] } });

        const spouse = getCurrentSpouse(graph, "HENRY");
        expect(spouse?.partnerId).toBe("ANNE");
    });
});