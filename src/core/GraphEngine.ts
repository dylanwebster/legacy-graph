import Graph from 'graphology';
import * as path from 'path';
import watcher from '@parcel/watcher';
import type { AsyncSubscription } from '@parcel/watcher';
import fg from 'fast-glob';
import pLimit from 'p-limit';
import { Worker } from 'worker_threads';
import { BootLoader } from './BootLoader';
import { StoryLoader, Story } from './StoryLoader';
import { SearchService } from './SearchService';
import { GraphCache, GraphCacheFile } from './GraphCache';
import { HydrationWorkerResult, HydrationWorkerError, PersonEntry } from './HydrationWorker';
import * as fs from 'fs/promises';
import yaml from 'js-yaml';
import { PersonSchema, Person, SlimPerson, toSlimPerson } from '../schemas/PersonSchema';
import { computeAllRelationships, invalidateComputed } from './GraphLogic';

export interface HydrationResult {
    fromCache: number;
    parsed: number;
    total: number;
}

export class GraphEngine {
    private graph: Graph;
    private rootDir: string;
    public searchService: SearchService;
    private _hydrationState: 'loading' | 'ready' = 'loading';
    private _cacheWrittenAt: string | null = null;

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

    /**
     * Current hydration state: 'loading' before/during hydration, 'ready' after.
     */
    public get hydrationState(): 'loading' | 'ready' {
        return this._hydrationState;
    }

    /**
     * ISO-8601 timestamp of when the binary cache was last written, or null if no cache exists.
     */
    public get cacheAge(): string | null {
        return this._cacheWrittenAt;
    }

    private fileMap: Map<string, string> = new Map(); // FilePath -> PersonID
    private reverseFileMap: Map<string, string> = new Map(); // PersonID -> FilePath
    private selfWriteMap: Map<string, number> = new Map(); // AbsolutePath -> expiry timestamp

    /**
     * Register a file path as written by the application itself.
     * The watcher will skip hot-patching for this file on the next event.
     * Entries expire after ttlMs (default 10000ms) to prevent memory leaks.
     */
    public registerSelfWrite(absolutePath: string, ttlMs: number = 10000): void {
        this.selfWriteMap.set(absolutePath, Date.now() + ttlMs);
    }

    /**
     * Check if a file path is in the self-write set (not expired).
     */
    public hasSelfWrite(absolutePath: string): boolean {
        const expiry = this.selfWriteMap.get(absolutePath);
        if (expiry === undefined) return false;
        if (Date.now() > expiry) {
            this.selfWriteMap.delete(absolutePath);
            return false;
        }
        return true;
    }

    /**
     * Consume (remove) a self-write entry if it exists and is not expired.
     * Returns true if the entry was consumed, false if not found or expired.
     */
    public consumeSelfWrite(absolutePath: string): boolean {
        const expiry = this.selfWriteMap.get(absolutePath);
        if (expiry === undefined) return false;
        if (Date.now() > expiry) {
            this.selfWriteMap.delete(absolutePath);
            return false;
        }
        this.selfWriteMap.delete(absolutePath);
        return true;
    }

    /**
     * Reverse lookup: get the source YAML file path for a person ID.
     * Used by the API to lazy-load heavy fields (scrapbook_md, _gedcom) from disk.
     */
    public getFilePathForPerson(personId: string): string | undefined {
        return this.reverseFileMap.get(personId);
    }

    /**
     * Lazy-load heavy fields (scrapbook_md, _gedcom) from the source YAML on disk.
     * These fields are stripped from the in-memory graph to reduce V8 heap usage (Slim Node Strategy).
     * Returns null if the person ID is unknown or the file cannot be read.
     */
    public async loadHeavyFields(personId: string): Promise<{ scrapbook_md: string; _gedcom?: Record<string, any> } | null> {
        const filePath = this.reverseFileMap.get(personId);
        if (!filePath) return null;

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const raw = yaml.load(content) as any;
            return {
                scrapbook_md: raw.scrapbook_md ?? '',
                _gedcom: raw._gedcom
            };
        } catch {
            return null;
        }
    }

    /**
     * Cache file path for the binary graph cache.
     */
    private get cachePath(): string {
        return path.join(this.rootDir, '_meta', '.graph-cache.json');
    }

    /**
     * File path for the persistent search index cache.
     */
    private get searchIndexPath(): string {
        return path.join(this.rootDir, '_meta', '.search-index.json');
    }

    /**
     * Loads all data from the file system and rebuilds the graph (inline, on the main thread).
     * Uses the Tiered Binary Cache when available for accelerated boot.
     * Retained for testing, simple usage, and as a fallback for worker failures.
     *
     * @param options.forceFullRebuild - Bypass cache and re-parse all YAML files (used by POST /system/rebuild)
     * @returns Hydration statistics (fromCache, parsed, total)
     */
    public async hydrate(options?: { forceFullRebuild?: boolean }): Promise<HydrationResult> {
        this._hydrationState = 'loading';
        console.log(`[GraphEngine] Hydrating graph (inline) from: ${this.rootDir}`);

        // 1. Load People — via cache (incremental) or full nuclear
        const cache = options?.forceFullRebuild
            ? null
            : await GraphCache.load(this.cachePath);

        let peopleWithMtime: PersonEntry[];
        let fromCache = 0;
        let parsed = 0;

        if (cache) {
            const result = await this.loadPeopleIncremental(cache);
            peopleWithMtime = result.results;
            fromCache = result.fromCache;
            parsed = result.parsed;
        } else {
            const result = await this.loadPeopleFull();
            peopleWithMtime = result.results;
            parsed = result.parsed;
        }

        // 2. Load Stories (Narrative Layer — always from disk)
        const storyLoader = new StoryLoader(path.join(this.rootDir, 'stories'));
        const stories = await storyLoader.loadAll().catch((err) => {
            console.warn(`[GraphEngine] Could not load stories: ${err.message}`);
            return [] as Story[];
        });

        // 3. Build graph from loaded data (shared with worker path)
        const result = await this.buildGraphFromData(peopleWithMtime, stories, fromCache, parsed);

        // 4. Persist binary cache for next boot
        await GraphCache.save(this.cachePath, peopleWithMtime);
        this._cacheWrittenAt = new Date().toISOString();

        // 5. Persist search index for next boot
        await this.searchService.exportIndex(this.searchIndexPath).catch(err => {
            console.warn(`[GraphEngine] Failed to export search index: ${err.message}`);
        });

        return result;
    }

    /**
     * Hydrate graph in a background Worker Thread (spec Section 2.3B).
     * The server remains responsive while the worker performs heavy I/O.
     * Falls back to inline hydrate() if the worker fails.
     *
     * @param options.forceFullRebuild - Bypass cache and re-parse all YAML files
     * @returns Promise that resolves when hydration is complete
     */
    public async hydrateInBackground(options?: { forceFullRebuild?: boolean }): Promise<HydrationResult> {
        this._hydrationState = 'loading';
        console.log(`[GraphEngine] Hydrating graph (worker thread) from: ${this.rootDir}`);

        try {
            const workerResult = await this.runWorker(options?.forceFullRebuild ?? false);
            const result = await this.buildGraphFromData(
                workerResult.people,
                workerResult.stories,
                workerResult.fromCache,
                workerResult.parsed
            );
            // Persist search index (worker saved graph cache, but search index is main-thread only)
            await this.searchService.exportIndex(this.searchIndexPath).catch(err => {
                console.warn(`[GraphEngine] Failed to export search index: ${err.message}`);
            });
            return result;
        } catch (err: any) {
            console.warn(`[GraphEngine] Worker failed, falling back to inline hydration: ${err.message}`);
            return this.hydrate(options);
        }
    }

    /**
     * Spawn a worker thread to perform heavy I/O (YAML parsing, Zod validation, story loading).
     * Returns the worker's output via postMessage.
     *
     * Uses tsx for TypeScript execution in the worker to handle ESM interop
     * (packages like p-limit v7+ are ESM-only but the project uses CommonJS).
     */
    private runWorker(forceFullRebuild: boolean): Promise<HydrationWorkerResult> {
        return new Promise((resolve, reject) => {
            // Detect TypeScript vs compiled JavaScript context
            const isTS = __filename.endsWith('.ts');
            const workerFile = isTS ? 'HydrationWorker.ts' : 'HydrationWorker.js';
            const workerPath = path.resolve(__dirname, workerFile);

            // tsx handles TypeScript compilation AND ESM/CJS interop in the worker thread
            const execArgv = isTS
                ? ['--require', 'tsx/cjs']
                : [];

            const worker = new Worker(workerPath, {
                workerData: { rootDir: this.rootDir, forceFullRebuild },
                execArgv
            });

            worker.on('message', (msg: HydrationWorkerResult | HydrationWorkerError) => {
                worker.terminate();
                if (msg.type === 'error') {
                    reject(new Error((msg as HydrationWorkerError).message));
                } else {
                    resolve(msg as HydrationWorkerResult);
                }
            });

            worker.on('error', (err) => {
                reject(err);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Build the Graphology graph, edges, search index, and _computed cache
     * from pre-loaded data. This is the lightweight "main thread" work that
     * runs after either inline loading or worker thread loading completes.
     */
    private async buildGraphFromData(
        peopleWithMtime: PersonEntry[],
        stories: Story[],
        fromCache: number,
        parsed: number
    ): Promise<HydrationResult> {
        this.graph.clear();
        this.fileMap.clear();
        this.reverseFileMap.clear();

        // 1. Try importing cached search index for incremental indexing
        const searchImport = await this.searchService.importIndex(this.searchIndexPath).catch(() => null);
        const currentPersonIds = new Set(peopleWithMtime.map(e => e.data.id));

        // Clean up deleted people from imported index
        if (searchImport) {
            for (const oldId of searchImport.personIds) {
                if (!currentPersonIds.has(oldId)) {
                    this.searchService.removePerson(oldId);
                }
            }
        }

        // 2. Add people nodes (Slim Node Strategy: strip scrapbook_md and _gedcom)
        const slimPeople: SlimPerson[] = [];
        peopleWithMtime.forEach(({ data: p, filePath, wasParsed }) => {
            const slim = toSlimPerson(p);
            this.graph.addNode(p.id, { type: 'person', data: slim });
            this.fileMap.set(filePath, p.id);
            this.reverseFileMap.set(p.id, filePath);
            slimPeople.push(slim);

            // Index: if search cache loaded, only re-index changed entries; otherwise index all
            if (!searchImport || wasParsed !== false) {
                this.searchService.indexPerson(slim, p.scrapbook_md || '');
            } else {
                this.searchService.trackPerson(p.id);
            }
        });

        // 3. Add story nodes + index
        stories.forEach(s => {
            this.graph.addNode(s.id, { type: 'story', data: s });
            if (!searchImport) {
                this.searchService.indexStory(s);
            } else {
                this.searchService.trackStory(s.id);
            }
        });

        // 3. Build Lineage Edges (Child -> Parent)
        slimPeople.forEach(p => {
            p.relationships.parents.forEach(parent => {
                if (this.graph.hasNode(parent.id)) {
                    this.graph.addEdge(p.id, parent.id, {
                        type: 'child_of',
                        relType: parent.type
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
                    this.graph.addEdge(s.id, personId, { type: 'mentions' });
                } else {
                    console.warn(`[GraphEngine] Story ${s.id} mentions missing person: ${personId}`);
                }
            });
        });

        // 5. Compute derived relationships (_computed cache)
        computeAllRelationships(this.graph);

        // 6. Update cache metadata (worker already saved cache; inline path saves after this)
        this._cacheWrittenAt = new Date().toISOString();
        this._hydrationState = 'ready';

        console.log(
            `[GraphEngine] Hydration Complete. Nodes: ${this.graph.order}, Edges: ${this.graph.size}` +
            ` (${fromCache} from cache, ${parsed} parsed)`
        );

        return { fromCache, parsed, total: peopleWithMtime.length };
    }

    /**
     * Full Nuclear Hydration: parse all YAML files via BootLoader, collect mtimes for cache.
     */
    private async loadPeopleFull(): Promise<{
        results: Array<{ data: Person; filePath: string; mtime: number }>;
        parsed: number;
    }> {
        const peopleLoader = new BootLoader(path.join(this.rootDir, 'people'));
        const peopleResults = await peopleLoader.loadAll().catch((err) => {
            console.warn(`[GraphEngine] Could not load people: ${err.message}`);
            return [];
        });

        const results: Array<{ data: Person; filePath: string; mtime: number; wasParsed?: boolean }> = [];
        for (const res of peopleResults) {
            try {
                const stats = await fs.stat(res.filePath);
                results.push({
                    data: res.data,
                    filePath: res.filePath,
                    mtime: Math.floor(stats.mtimeMs),
                    wasParsed: true
                });
            } catch {
                // File deleted between load and stat — skip
            }
        }

        return { results, parsed: results.length };
    }

    /**
     * Incremental Hydration: compare file mtimes against cache, only re-parse stale files.
     */
    private async loadPeopleIncremental(cache: GraphCacheFile): Promise<{
        results: Array<{ data: Person; filePath: string; mtime: number }>;
        fromCache: number;
        parsed: number;
    }> {
        const peopleDir = path.join(this.rootDir, 'people');
        const pattern = path.join(peopleDir, '*.yaml').replace(/\\/g, '/');
        const files = await fg(pattern).catch(() => [] as string[]);

        const results: Array<{ data: Person; filePath: string; mtime: number; wasParsed?: boolean }> = [];
        let fromCache = 0;
        let parsed = 0;

        const limit = pLimit(50);

        await Promise.all(files.map(file => limit(async () => {
            try {
                const stats = await fs.stat(file);
                const mtime = Math.floor(stats.mtimeMs);
                const cacheEntry = cache.entries[file];

                if (cacheEntry && cacheEntry.mtime === mtime) {
                    // Cache hit — use pre-validated data
                    results.push({ data: cacheEntry.data as Person, filePath: file, mtime, wasParsed: false });
                    fromCache++;
                } else {
                    // Cache miss — parse from YAML + Zod validate
                    const content = await fs.readFile(file, 'utf8');
                    const raw = yaml.load(content);
                    const data = PersonSchema.parse(raw);
                    results.push({ data, filePath: file, mtime, wasParsed: true });
                    parsed++;
                }
            } catch (err: any) {
                console.warn(`[GraphEngine] Failed to process ${file}: ${err.message}`);
            }
        })));

        return { results, fromCache, parsed };
    }

    private watcherSubscription: AsyncSubscription | null = null;

    /**
     * Starts the File System Watcher using @parcel/watcher (native OS APIs).
     * Uses FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux.
     * Watches the `people/` directory for hot-patching.
     */
    public async startWatcher(): Promise<void> {
        const watchPath = path.join(this.rootDir, 'people');
        console.log(`[GraphEngine] Starting FS Watcher on ${watchPath}...`);

        this.watcherSubscription = await watcher.subscribe(
            watchPath,
            (err, events) => {
                if (err) {
                    console.error('[GraphEngine] Watcher error:', err);
                    return;
                }
                for (const event of events) {
                    // Only handle YAML files, ignore dotfiles
                    if (!event.path.endsWith('.yaml')) continue;
                    if (path.basename(event.path).startsWith('.')) continue;

                    switch (event.type) {
                        case 'create':
                        case 'update':
                            this.handleFileUpdate(event.path);
                            break;
                        case 'delete':
                            this.handleFileRemove(event.path);
                            break;
                    }
                }
            },
            {
                ignore: ['.*', '**/.git/**']
            }
        );
    }

    /**
     * Stops the file system watcher and cleans up the subscription.
     * Safe to call multiple times (no-op if no active subscription).
     */
    public async stopWatcher(): Promise<void> {
        if (this.watcherSubscription) {
            await this.watcherSubscription.unsubscribe();
            this.watcherSubscription = null;
        }
    }

    private async handleFileUpdate(filePath: string) {
        // Write-event deduplication: skip if this change was made by the application itself
        if (this.consumeSelfWrite(filePath)) {
            return;
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            const raw = yaml.load(content);
            const newPerson = PersonSchema.parse(raw);
            const slim = toSlimPerson(newPerson);

            // Handle ID changes (rare): treat as remove old + add new
            const existingId = this.fileMap.get(filePath);
            if (existingId && existingId !== newPerson.id) {
                this.removeNode(existingId);
            }

            // Capture old state before updating the node (already slim in graph)
            let oldData: SlimPerson | null = null;
            if (this.graph.hasNode(newPerson.id)) {
                oldData = this.graph.getNodeAttributes(newPerson.id).data as SlimPerson;
            }

            // Update (or create) graph node with slim data
            if (this.graph.hasNode(newPerson.id)) {
                this.graph.mergeNodeAttributes(newPerson.id, { data: slim });
            } else {
                this.graph.addNode(newPerson.id, { type: 'person', data: slim });
            }
            this.fileMap.set(filePath, newPerson.id);
            this.reverseFileMap.set(newPerson.id, filePath);

            // Diff-based edge reconciliation
            if (oldData) {
                this.reconcileEdges(newPerson.id, oldData, slim);
            } else {
                // New node — add all parent edges
                this.addParentEdges(slim);
            }

            // Update search index (pass bio from full Person before it was stripped)
            this.searchService.indexPerson(slim, newPerson.scrapbook_md || '');

            // Recompute _computed for this node and all neighbors
            invalidateComputed(this.graph, newPerson.id);

        } catch (err: any) {
            console.error(`[GraphEngine] Failed to hot-patch ${filePath}: ${err.message}`);
        }
    }

    /**
     * Diff-Based Edge Reconciliation (spec 4.1).
     * Compares old vs. new parent references and applies minimal edge changes.
     * Falls back to drop-all-and-rebuild if the diff produces an inconsistent state.
     */
    private reconcileEdges(nodeId: string, oldPerson: SlimPerson, newPerson: SlimPerson): void {
        try {
            const oldParentIds = new Set(oldPerson.relationships.parents.map(p => p.id));
            const newParentIds = new Set(newPerson.relationships.parents.map(p => p.id));
            const newParentMap = new Map(newPerson.relationships.parents.map(p => [p.id, p]));
            const oldParentMap = new Map(oldPerson.relationships.parents.map(p => [p.id, p]));

            // 1. Remove edges for dropped parents
            for (const oldParentId of oldParentIds) {
                if (!newParentIds.has(oldParentId)) {
                    const edges = this.graph.outEdges(nodeId).filter(edge => {
                        const attrs = this.graph.getEdgeAttributes(edge);
                        return attrs.type === 'child_of' && this.graph.target(edge) === oldParentId;
                    });
                    edges.forEach(edge => this.graph.dropEdge(edge));
                }
            }

            // 2. Add edges for new parents
            for (const newParentId of newParentIds) {
                if (!oldParentIds.has(newParentId)) {
                    if (this.graph.hasNode(newParentId)) {
                        const parent = newParentMap.get(newParentId)!;
                        this.graph.addEdge(nodeId, newParentId, {
                            type: 'child_of',
                            relType: parent.type
                        });
                    }
                }
            }

            // 3. Handle relationship type changes for retained parents
            for (const parentId of newParentIds) {
                if (oldParentIds.has(parentId)) {
                    const newParent = newParentMap.get(parentId)!;
                    const oldParent = oldParentMap.get(parentId)!;
                    if (oldParent.type !== newParent.type) {
                        const edge = this.graph.outEdges(nodeId).find(e => {
                            const attrs = this.graph.getEdgeAttributes(e);
                            return attrs.type === 'child_of' && this.graph.target(e) === parentId;
                        });
                        if (edge) {
                            this.graph.setEdgeAttribute(edge, 'relType', newParent.type);
                        }
                    }
                }
            }
        } catch (err: any) {
            // Fallback: mini-hydration (drop all child_of edges and rebuild)
            console.warn(`[GraphEngine] Edge diff failed for ${nodeId}, falling back to mini-hydration: ${err.message}`);
            this.fallbackRebuildEdges(nodeId, newPerson);
        }
    }

    /**
     * Mini-hydration fallback: drops all outgoing child_of edges and rebuilds from scratch.
     * Used when diff-based reconciliation detects an inconsistent state.
     */
    private fallbackRebuildEdges(nodeId: string, person: SlimPerson): void {
        if (this.graph.hasNode(nodeId)) {
            const edgesToDrop = this.graph.outEdges(nodeId).filter(edge =>
                this.graph.getEdgeAttributes(edge).type === 'child_of'
            );
            edgesToDrop.forEach(edge => this.graph.dropEdge(edge));
        }
        this.addParentEdges(person);
    }

    /**
     * Add child_of edges for all of a person's parents.
     */
    private addParentEdges(person: SlimPerson): void {
        person.relationships.parents.forEach(parent => {
            if (this.graph.hasNode(parent.id)) {
                this.graph.addEdge(person.id, parent.id, {
                    type: 'child_of',
                    relType: parent.type
                });
            }
        });
    }

    private handleFileRemove(filePath: string) {
        // Write-event deduplication: skip if this change was made by the application itself
        if (this.consumeSelfWrite(filePath)) {
            return;
        }

        const id = this.fileMap.get(filePath);
        if (id) {
            this.removeNode(id);
            this.fileMap.delete(filePath);
            this.reverseFileMap.delete(id);
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