import { describe, it, expect, beforeEach } from 'vitest';
import Graph from 'graphology';
import { getAggregatedAssets, getCurrentSpouse, computeRelationships, computeAllRelationships, getLineage } from '../../src/core/GraphLogic';
import { Person } from '../../src/schemas/PersonSchema';

// Helper to create a minimal Person object
function makePerson(id: string, overrides: Partial<Person> = {}): Person {
    return {
        version: "5.1",
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

describe('Graph Logic', () => {
    let graph: Graph;
    
    beforeEach(() => {
        graph = new Graph({ type: 'directed', multi: true });
    });

    // --- ASSET PROPAGATION TEST (Transitive Logic) ---
    it('should aggregate assets from Person, Events, and Stories', () => {
        // 1. Person with direct asset + event asset
        const person: Person = {
            version: "5.1", id: "P1", names: [], sex: "M", tags: [], relationships: {parents:[]}, created:"", last_modified:"",
            assets: ["direct.jpg"],
            scrapbook_md: "",
            events: [
                { id: "e1", type: "birth", date: "1900", sort_date: "1900-01-01", assets: ["birth.jpg"] } as any
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
            version: "5.1", id: "HENRY", names: [], sex: "M", tags: [], relationships: {parents:[]}, created:"", last_modified:"", assets:[],
            scrapbook_md: "",
            events: [
                { id: "e1", type: "marriage", date: "1509", sort_date: "1509", partner_id: "CATH", status: "married", assets: [] },
                { id: "e2", type: "divorce", date: "1533", sort_date: "1533", partner_id: "CATH", assets: [] },
                { id: "e3", type: "marriage", date: "1533", sort_date: "1533-05", partner_id: "ANNE", status: "married", assets: [] }
            ] as any
        };
        graph.addNode("HENRY", { type: 'person', data: henry });
        graph.addNode("CATH", { type: 'person', data: { ...henry, id: "CATH", events: [] } });
        graph.addNode("ANNE", { type: 'person', data: { ...henry, id: "ANNE", events: [] } });

        const spouse = getCurrentSpouse(graph, "HENRY");
        expect(spouse?.partnerId).toBe("ANNE");
    });

    // --- COMPUTED RELATIONSHIPS TESTS ---
    describe('computeRelationships', () => {
        it('should populate _computed with currentSpouse, siblings, children, allSpouses', () => {
            // Build a family: Father + Mother -> Child
            const father = makePerson('N_father', { sex: 'M' });
            const mother = makePerson('N_mother', { sex: 'F' });
            const child = makePerson('N_child', {
                relationships: {
                    parents: [
                        { id: 'N_father', type: 'biological' },
                        { id: 'N_mother', type: 'biological' }
                    ]
                }
            });

            graph.addNode('N_father', { type: 'person', data: father });
            graph.addNode('N_mother', { type: 'person', data: mother });
            graph.addNode('N_child', { type: 'person', data: child });
            graph.addEdge('N_child', 'N_father', { type: 'child_of', relType: 'biological' });
            graph.addEdge('N_child', 'N_mother', { type: 'child_of', relType: 'biological' });

            computeRelationships(graph, 'N_father');
            const computed = graph.getNodeAttribute('N_father', '_computed');

            expect(computed).toBeDefined();
            expect(computed.children).toContain('N_child');
            expect(computed.currentSpouse).toBeNull(); // No marriage events
            expect(computed.siblings).toEqual([]);
            expect(computed.allSpouses).toEqual([]);
        });

        it('should compute siblings correctly (shared parents)', () => {
            const father = makePerson('N_dad');
            const child1 = makePerson('N_c1', {
                relationships: { parents: [{ id: 'N_dad', type: 'biological' }] }
            });
            const child2 = makePerson('N_c2', {
                relationships: { parents: [{ id: 'N_dad', type: 'biological' }] }
            });

            graph.addNode('N_dad', { type: 'person', data: father });
            graph.addNode('N_c1', { type: 'person', data: child1 });
            graph.addNode('N_c2', { type: 'person', data: child2 });
            graph.addEdge('N_c1', 'N_dad', { type: 'child_of', relType: 'biological' });
            graph.addEdge('N_c2', 'N_dad', { type: 'child_of', relType: 'biological' });

            computeRelationships(graph, 'N_c1');
            const computed = graph.getNodeAttribute('N_c1', '_computed');

            expect(computed.siblings).toContain('N_c2');
            expect(computed.siblings).not.toContain('N_c1'); // Not self
        });

        it('should compute currentSpouse and allSpouses with marriage history', () => {
            const person = makePerson('N_henry', {
                sex: 'M',
                events: [
                    { id: 'e1', type: 'marriage', date: '1509', sort_date: '1509-01-01', partner_id: 'N_cath', status: 'married', assets: [] },
                    { id: 'e2', type: 'divorce', date: '1533', sort_date: '1533-01-01', partner_id: 'N_cath', assets: [] },
                    { id: 'e3', type: 'marriage', date: '1533', sort_date: '1533-06-01', partner_id: 'N_anne', status: 'married', assets: [] },
                ] as any
            });
            const cath = makePerson('N_cath', { sex: 'F' });
            const anne = makePerson('N_anne', { sex: 'F' });

            graph.addNode('N_henry', { type: 'person', data: person });
            graph.addNode('N_cath', { type: 'person', data: cath });
            graph.addNode('N_anne', { type: 'person', data: anne });

            computeRelationships(graph, 'N_henry');
            const computed = graph.getNodeAttribute('N_henry', '_computed');

            expect(computed.currentSpouse).toEqual({ id: 'N_anne', status: 'married' });
            expect(computed.allSpouses).toHaveLength(2);
            expect(computed.allSpouses.find((s: any) => s.id === 'N_cath')?.status).toBe('divorced');
            expect(computed.allSpouses.find((s: any) => s.id === 'N_anne')?.status).toBe('married');
        });

        it('should detect widowed status when spouse has death event', () => {
            const person = makePerson('N_widow', {
                events: [
                    { id: 'e1', type: 'marriage', date: '1950', sort_date: '1950-01-01', partner_id: 'N_deceased', status: 'married', assets: [] }
                ] as any
            });
            const deceased = makePerson('N_deceased', {
                events: [
                    { id: 'e2', type: 'death', date: '2000', sort_date: '2000-01-01', cause: 'natural', assets: [] }
                ] as any
            });

            graph.addNode('N_widow', { type: 'person', data: person });
            graph.addNode('N_deceased', { type: 'person', data: deceased });

            computeRelationships(graph, 'N_widow');
            const computed = graph.getNodeAttribute('N_widow', '_computed');

            expect(computed.currentSpouse).toEqual({ id: 'N_deceased', status: 'widowed' });
        });

        it('should return empty _computed for non-person nodes', () => {
            graph.addNode('story1', { type: 'story', data: {} });
            computeRelationships(graph, 'story1');
            const computed = graph.getNodeAttribute('story1', '_computed');
            expect(computed).toBeNull();
        });
    });

    describe('computeAllRelationships', () => {
        it('should populate _computed for ALL person nodes in the graph', () => {
            const father = makePerson('N_dad');
            const child = makePerson('N_kid', {
                relationships: { parents: [{ id: 'N_dad', type: 'biological' }] }
            });

            graph.addNode('N_dad', { type: 'person', data: father });
            graph.addNode('N_kid', { type: 'person', data: child });
            graph.addEdge('N_kid', 'N_dad', { type: 'child_of', relType: 'biological' });

            computeAllRelationships(graph);

            const dadComputed = graph.getNodeAttribute('N_dad', '_computed');
            const kidComputed = graph.getNodeAttribute('N_kid', '_computed');

            expect(dadComputed).toBeDefined();
            expect(dadComputed.children).toContain('N_kid');

            expect(kidComputed).toBeDefined();
            expect(kidComputed.siblings).toEqual([]);
        });
    });

    describe('getLineage', () => {
        // Build a 3-generation family with a spouse at the descendant level.
        //
        //          N_gp1 - N_gp2
        //                \  /
        //                N_parent — N_spouse
        //                |
        //                N_child
        //
        function buildThreeGen() {
            graph.addNode('N_gp1', { type: 'person', data: makePerson('N_gp1') });
            graph.addNode('N_gp2', { type: 'person', data: makePerson('N_gp2') });
            const parent = makePerson('N_parent', {
                relationships: {
                    parents: [
                        { id: 'N_gp1', type: 'biological' },
                        { id: 'N_gp2', type: 'biological' },
                    ],
                },
                events: [{
                    id: 'm1', type: 'marriage', date: '1950', sort_date: '1950-01-01',
                    partner_id: 'N_spouse', status: 'married', assets: [],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any],
            });
            graph.addNode('N_parent', { type: 'person', data: parent });
            graph.addNode('N_spouse', {
                type: 'person',
                data: makePerson('N_spouse', {
                    events: [{
                        id: 'm1', type: 'marriage', date: '1950', sort_date: '1950-01-01',
                        partner_id: 'N_parent', status: 'married', assets: [],
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any],
                }),
            });
            graph.addNode('N_child', {
                type: 'person',
                data: makePerson('N_child', {
                    relationships: {
                        parents: [{ id: 'N_parent', type: 'biological' }],
                    },
                }),
            });
            graph.addEdge('N_parent', 'N_gp1', { type: 'child_of', relType: 'biological' });
            graph.addEdge('N_parent', 'N_gp2', { type: 'child_of', relType: 'biological' });
            graph.addEdge('N_child', 'N_parent', { type: 'child_of', relType: 'biological' });
            computeAllRelationships(graph);
        }

        it('returns ancestors + descendants + self for the focal person', () => {
            buildThreeGen();
            const set = getLineage(graph, 'N_parent');
            expect(set.has('N_parent')).toBe(true);   // self
            expect(set.has('N_gp1')).toBe(true);      // ancestor
            expect(set.has('N_gp2')).toBe(true);      // ancestor
            expect(set.has('N_child')).toBe(true);    // descendant
        });

        it('includes spouses of lineage members by default', () => {
            buildThreeGen();
            const set = getLineage(graph, 'N_parent');
            expect(set.has('N_spouse')).toBe(true);
        });

        it('can exclude spouses when asked', () => {
            buildThreeGen();
            const set = getLineage(graph, 'N_parent', { includeSpouses: false });
            expect(set.has('N_spouse')).toBe(false);
            expect(set.has('N_parent')).toBe(true);
        });

        it('returns an empty set for an unknown person', () => {
            const set = getLineage(graph, 'N_unknown');
            expect(set.size).toBe(0);
        });

        it('returns just the person when they have no parents or children', () => {
            graph.addNode('N_lonely', { type: 'person', data: makePerson('N_lonely') });
            const set = getLineage(graph, 'N_lonely');
            expect(Array.from(set)).toEqual(['N_lonely']);
        });
    });
});