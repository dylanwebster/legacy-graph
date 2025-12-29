import Graph from 'graphology';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { BootLoader } from './BootLoader';
import { StoryLoader } from './StoryLoader';

export class GraphEngine {
    private graph: Graph;
    private rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        // Multi-graph allows parallel edges (e.g., biological + adopted relations between same two people)
        this.graph = new Graph({ type: 'directed', multi: true });
    }

    /**
     * Returns the raw Graphology instance for querying.
     */
    public getGraph(): Graph {
        return this.graph;
    }

    /**
     * Loads all data from the file system and rebuilds the graph from scratch.
     * This is the "Nuclear" strategy defined in Phase 2.
     */
    public async hydrate(): Promise<void> {
        console.log(`[GraphEngine] Hydrating graph from: ${this.rootDir}`);
        this.graph.clear();

        // 1. Load People (Head 1: Source of Truth)
        const peopleLoader = new BootLoader(path.join(this.rootDir, 'people'));
        // We catch errors here in case the 'people' directory doesn't exist yet (fresh install)
        const people = await peopleLoader.loadAll().catch((err) => {
            console.warn(`[GraphEngine] Could not load people: ${err.message}`);
            return [];
        });

        people.forEach(p => {
            this.graph.addNode(p.id, { 
                type: 'person', 
                data: p 
            });
        });

        // 2. Load Stories (Narrative Layer)
        const storyLoader = new StoryLoader(path.join(this.rootDir, 'stories'));
        const stories = await storyLoader.loadAll().catch((err) => {
            console.warn(`[GraphEngine] Could not load stories: ${err.message}`);
            return [];
        });

        stories.forEach(s => {
            this.graph.addNode(s.id, { 
                type: 'story', 
                data: s 
            });
        });

        // 3. Build Lineage Edges (Child -> Parent)
        people.forEach(p => {
            p.relationships.parents.forEach(parent => {
                if (this.graph.hasNode(parent.id)) {
                    this.graph.addEdge(p.id, parent.id, { 
                        type: 'child_of', 
                        relType: parent.type // biological, adopted, etc.
                    });
                } else {
                    console.warn(`[GraphEngine] Orphan Parent Reference: ${p.id} -> ${parent.id}`);
                }
            });
        });

        // 4. Build Narrative Edges (Story -> Mentions)
        stories.forEach(s => {
            s.mentions.forEach(personId => {
                if (this.graph.hasNode(personId)) {
                    this.graph.addEdge(s.id, personId, { 
                        type: 'mentions' 
                    });
                } else {
                    console.warn(`[GraphEngine] Story ${s.id} mentions missing person: ${personId}`);
                }
            });
        });

        console.log(`[GraphEngine] Hydration Complete. Nodes: ${this.graph.order}, Edges: ${this.graph.size}`);
    }

    /**
     * Starts the File System Watcher.
     * Any change to files in rootDir will trigger a full re-hydration.
     */
    public startWatcher() {
        console.log(`[GraphEngine] Starting FS Watcher on ${this.rootDir}...`);
        
        const watcher = chokidar.watch(this.rootDir, { 
            ignoreInitial: true, // Don't trigger 'add' events for existing files on boot
            ignored: /(^|[\/\\])\../, // Ignore dotfiles
            persistent: true
        });
        
        // "Nuclear" Strategy: Reload the entire graph on any change.
        watcher.on('all', async (event, filePath) => {
            console.log(`[Watcher] Change detected (${event}): ${filePath}`);
            try {
                await this.hydrate();
            } catch (err) {
                console.error("[Watcher] Hydration failed:", err);
            }
        });
    }
}