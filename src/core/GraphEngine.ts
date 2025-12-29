// src/core/GraphEngine.ts
import Graph from 'graphology';
import * as path from 'path';
import { BootLoader } from './BootLoader';
import { StoryLoader } from './StoryLoader';

export class GraphEngine {
    private graph: Graph;
    private rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        // Multi-graph allows parallel edges (e.g. biological + adopted relations)
        this.graph = new Graph({ type: 'directed', multi: true });
    }

    getGraph() { return this.graph; }

    async hydrate(): Promise<void> {
        this.graph.clear();

        // 1. Load People
        const bootLoader = new BootLoader(path.join(this.rootDir, 'people'));
        // Note: In real app, handle missing dir gracefully
        const people = await bootLoader.loadAll().catch(() => []);

        people.forEach(p => {
            this.graph.addNode(p.id, { type: 'person', data: p });
        });

        // 2. Load Stories
        const storyLoader = new StoryLoader(path.join(this.rootDir, 'stories'));
        const stories = await storyLoader.loadAll().catch(() => []);

        stories.forEach(s => {
            this.graph.addNode(s.id, { type: 'story', data: s });
        });

        // 3. Build Edges: Relationships 
        people.forEach(p => {
            p.relationships.parents.forEach(parent => {
                if (this.graph.hasNode(parent.id)) {
                    this.graph.addEdge(p.id, parent.id, {
                        type: 'child_of',
                        relType: parent.type
                    });
                }
            });
        });

        // 4. Build Edges: Mentions
        stories.forEach(s => {
            s.mentions.forEach(personId => {
                if (this.graph.hasNode(personId)) {
                    this.graph.addEdge(s.id, personId, { type: 'mentions' });
                }
            });
        });
    }
}