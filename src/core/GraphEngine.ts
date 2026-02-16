import Graph from 'graphology';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { BootLoader } from './BootLoader';
import { StoryLoader } from './StoryLoader';
import { SearchService } from './SearchService';
import * as fs from 'fs/promises';
import yaml from 'js-yaml';
import { PersonSchema, Person } from '../schemas/PersonSchema';
import { computeAllRelationships, invalidateComputed } from './GraphLogic';

export class GraphEngine {
    private graph: Graph;
    private rootDir: string;
    public searchService: SearchService;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        // Multi-graph allows parallel edges (e.g., biological + adopted relations between same two people)
        this.graph = new Graph({ type: 'directed', multi: true });
        this.searchService = new SearchService();
    }

    /**
     * Returns the raw Graphology instance for querying.
     */
    public getGraph(): Graph {
        return this.graph;
    }

    private fileMap: Map<string, string> = new Map(); // FilePath -> PersonID

    /**
     * Loads all data from the file system and rebuilds the graph from scratch.
     * This is the "Nuclear" strategy defined in Phase 2.
     */
    public async hydrate(): Promise<void> {
        console.log(`[GraphEngine] Hydrating graph from: ${this.rootDir}`);
        this.graph.clear();
        this.fileMap.clear();

        // 1. Load People (Head 1: Source of Truth)
        const peopleLoader = new BootLoader(path.join(this.rootDir, 'people'));
        // We catch errors here in case the 'people' directory doesn't exist yet (fresh install)
        const peopleResults = await peopleLoader.loadAll().catch((err) => {
            console.warn(`[GraphEngine] Could not load people: ${err.message}`);
            return [];
        });

        peopleResults.forEach(res => {
            const p = res.data;
            this.graph.addNode(p.id, { 
                type: 'person', 
                data: p 
            });
            this.fileMap.set(res.filePath, p.id);
        });

        const people = peopleResults.map(r => r.data);

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

        // 5. Indexing (Search Service)
        // Reset/Rebuild index with new graph data
        await this.searchService.rebuild(this.graph);

        // 6. Compute derived relationships (_computed cache)
        computeAllRelationships(this.graph);

        console.log(`[GraphEngine] Hydration Complete. Nodes: ${this.graph.order}, Edges: ${this.graph.size}`);
    }

    /**
     * Starts the File System Watcher.
     * Any change to files in rootDir will trigger a full re-hydration.
     */
    public startWatcher(): chokidar.FSWatcher {
        // Only watch 'people' for hot patching for now, as story logic is simpler
        // But the requirement implies general watching.
        // We'll focus on People hot-patching as that's the complex part.
        const watchPath = path.join(this.rootDir, 'people');
        console.log(`[GraphEngine] Starting FS Watcher on ${watchPath}...`);
        
        const watcher = chokidar.watch(watchPath, { 
            ignoreInitial: true, // Don't trigger 'add' events for existing files on boot
            ignored: /(^|[\/\\])\../, // Ignore dotfiles
            persistent: true
        });
        
        // Granular Updates
        watcher.on('add', (fp) => this.handleFileUpdate(fp));
        watcher.on('change', (fp) => this.handleFileUpdate(fp));
        watcher.on('unlink', (fp) => this.handleFileRemove(fp));

        return watcher;
    }

    private async handleFileUpdate(filePath: string) {
        // console.log(`[GraphEngine] Hot-patching update: ${filePath}`);
        // 1. Read & Parse
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const raw = yaml.load(content);
            const person = PersonSchema.parse(raw);

            // 2. Check overlap
            const existingId = this.fileMap.get(filePath);
            if (existingId && existingId !== person.id) {
                // ID changed! Treat as remove old + add new
                this.removeNode(existingId);
            }

            // 3. Update Graph Node
            if (this.graph.hasNode(person.id)) {
                this.graph.mergeNodeAttributes(person.id, { data: person });
            } else {
                this.graph.addNode(person.id, { type: 'person', data: person });
            }
            this.fileMap.set(filePath, person.id);

            // 4. Rebuild Edges for this node
            // Clear outgoing edges
            if (this.graph.hasNode(person.id)) {
                 this.graph.outEdges(person.id).forEach(edge => this.graph.dropEdge(edge));
            }

            // Re-add edges
            person.relationships.parents.forEach((parent: any) => {
                if (this.graph.hasNode(parent.id)) {
                    this.graph.addEdge(person.id, parent.id, { 
                        type: 'child_of', 
                        relType: parent.type 
                    });
                }
            });

            // 5. Update Search
            this.searchService.indexPerson(person); // overwrites by ID

            // 6. Recompute _computed for this node and all neighbors
            invalidateComputed(this.graph, person.id);

        } catch (err: any) {
            console.error(`[GraphEngine] Failed to hot-patch ${filePath}: ${err.message}`);
        }
    }

    private handleFileRemove(filePath: string) {
        const id = this.fileMap.get(filePath);
        if (id) {
            this.removeNode(id);
            this.fileMap.delete(filePath);
            console.log(`[GraphEngine] Hot-removed ${id}`);
        }
    }

    private removeNode(id: string) {
        if (this.graph.hasNode(id)) {
            this.graph.dropNode(id);
            this.searchService.removePerson(id);
        }
    }

}