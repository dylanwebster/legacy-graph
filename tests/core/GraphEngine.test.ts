// tests/core/GraphEngine.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../../src/core/GraphEngine';

const DATA_DIR = path.join(__dirname, 'temp_graph_data');
const PEOPLE_DIR = path.join(DATA_DIR, 'people');
const STORIES_DIR = path.join(DATA_DIR, 'stories');

describe('GraphEngine Topology', () => {
    beforeAll(() => {
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PEOPLE_DIR, { recursive: true });
        fs.mkdirSync(STORIES_DIR, { recursive: true });

        // 1. Create Parent (N_DAD)
        fs.writeFileSync(path.join(PEOPLE_DIR, 'dad.yaml'), `
version: "5.1"
id: "N_DAD"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names: [{first: "Dad", last: "Test"}]
sex: "M"
relationships: { parents: [] }
events: []
assets: []
`);

        // 2. Create Child (N_SON) linked to Parent
        fs.writeFileSync(path.join(PEOPLE_DIR, 'son.yaml'), `
version: "5.1"
id: "N_SON"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names: [{first: "Son", last: "Test"}]
sex: "M"
relationships: 
  parents: [{id: "N_DAD", type: "biological"}]
events: []
assets: []
`);

        // 3. Create Story referencing Dad
        fs.writeFileSync(path.join(STORIES_DIR, 'story.md'), `---
title: "Dad's Story"
---
About @N_DAD.`);
    });

    afterAll(() => {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it('should build nodes and edges correctly', async () => {
        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate();

        const graph = engine.getGraph();

        // Nodes exist?
        expect(graph.hasNode("N_DAD")).toBe(true);
        expect(graph.hasNode("N_SON")).toBe(true);

        // Edge: Child -> Parent
        expect(graph.hasEdge("N_SON", "N_DAD")).toBe(true);

        // Edge: Story -> Mentions
        // Story ID is filename "story.md"
        expect(graph.hasNode("story.md")).toBe(true);
        expect(graph.hasEdge("story.md", "N_DAD")).toBe(true);
    });
});