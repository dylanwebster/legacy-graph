# **LegacyGraph: Master Technical Specification (v5.0)**

---

## **1. Executive Summary & Core Axioms**

LegacyGraph is a professional-grade, self-hosted genealogy platform. It rejects proprietary database "lock-in", treating family history as a durable, version-controlled, human-readable file system.

### **1.1 Core Axioms**

1.  **The "Notepad" Rule**: The database **IS** the file system. A user must be able to navigate, read, and understand their entire family history using only a basic text editor (VS Code, Notepad). The application is an _enhancer_, not a gatekeeper.
2.  **Git is the Undo Button**: Every save action in the UI is captured by Git. Rapid edits are batched into atomic commits via a debounced queue (see Section 7.1).
3.  **Event-Sourced Truth**: Relationships (Spouse) are computed from Events (Marriage - Divorce), not stored as static fields.
4.  **Local-First Security**: Authentication is local. No cloud dependencies.
5.  **Data Density**: The UI prioritizes information density over whitespace (VS Code aesthetic).

### **1.2 Rules of Engagement**

*   **Spec First**: Before any code is checked in for subsequent phases of implementation, this spec document must be updated and kept up to date. Discrepancies between Spec and Code are treated as critical bugs.
*   **Test-Driven Design (TDD) IS MANDATORY**: You must write a failing test case before writing any implementation code. This ensures all logic is verifiable and requirements are explicitly understood before coding.
*   **Hybrid Hydration**: We use "Nuclear" hydration (reload all) on boot for safety, accelerated by a **Tiered Cache** (see Section 2.3), and **Granular Hot-Patching** with diff-based edge reconciliation during live updates for sub-100ms feedback.

---

## **2. System Architecture: The "Dual-Head" Pattern**

### **2.1 Head 1: The Source of Truth (Persistence)**

- **Storage**: Local File System.
- **Format**:
  - **Data**: YAML (`/people/*.yaml`) - Structured Person Data.
  - **Narrative**: Markdown (`/stories/*.md`) - Rich text stories/articles.
  - **Media**: Binary (`/assets/*`) - JPG, PNG, WEBP, PDF, MP4.
  - **Meta**: Indices (`/_meta/*.yaml`) - Global configuration and caches.
- **Control**: Hidden `.git` directory managing the entire state.

### **2.2 Head 2: The Experience (Runtime)**

- **Engine**: Node.js (Fastify) + Graphology (In-Memory Graph).
- **Behavior**:
  - **Nuclear Hydration**: On boot, the engine reads **all** files to build the graph in RAM (see 2.3 for scaling strategy).
  - **Hot-Patching**: `@parcel/watcher` watches both `people/` (YAML) and `stories/` (Markdown) directories via native OS APIs (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux). Granular handlers (`create`, `update`, `delete`) update/patch specific nodes in <100ms without full reloads. Person edge updates use a **Diff-Based Reconciliation** strategy (see 4.1). Story updates reconcile `mentions` edges and surgically re-index search.
  - **Indexing**: FlexSearch (In-Memory) for full-text search. Loaded from a persistent serialized index on boot when available (see 2.3D), with surgical re-indexing of changed nodes. Incrementally updated during hot-patching. Tracked document IDs use `Set<string>` for O(1) membership checks during hydration and export.
  - **Computed Cache**: Derived relationships (spouses, siblings) are pre-computed and stored as volatile `_computed` attributes on Graphology nodes, invalidated surgically on change events (see 4.1).

### **2.3 Performance Architecture: Tiered Hydration & Scaling**

The Dual-Head pattern is elegant for small to medium datasets but requires deliberate scaling strategies to avoid bottlenecks as the graph grows beyond thousands of nodes.

**A. Tiered Cache Model**

Nuclear Hydration (parsing and Zod-validating every YAML on boot) scales linearly with dataset size. For large datasets (10,000+ people), this blocks the Node.js event loop and delays startup.

- **Binary Cache**: An intermediate serialized cache (JSON blob at `/_meta/.graph-cache.json`) sits between YAML files and the Graphology runtime. On boot, the engine checks if the cache exists and is fresh.
- **Incremental Rebuild**: The cache stores the `mtime` (last modified time) of every source YAML file. On boot, only files whose `mtime` is newer than the cached entry are re-parsed from YAML. All other nodes load directly from the pre-validated cache.
- **Cache Invalidation**: The cache is considered stale and triggers full Nuclear Hydration when: (a) the cache file is missing, (b) the `spec_version` in the cache header does not match the current schema version, or (c) the user explicitly requests a full rebuild via the API.

**B. Memory Budget & Scaling Ceiling (Slim Node Strategy)**

Graphology and FlexSearch run entirely in memory. While 10,000 nodes is trivial (~50MB), 100,000 nodes with rich Markdown scrapbooks and extensive FlexSearch indices can push Node.js toward the default V8 heap limit (~1.5–2GB). If 50,000 users have 2KB of markdown notes each, that is ~100MB of raw text sitting idle in the V8 heap until a detail page is opened.

- **Slim Node Principle**: The in-memory Graphology runtime stores **only the fields required for graph traversal, search indexing, and computed relationships**. Heavy payload fields — `scrapbook_md` (free-form Markdown) and `_gedcom` (loss-prevention data) — are **stripped from the in-memory `data` attribute** during hydration and hot-patching. This applies to both the Graphology node and the binary cache.
- **Lazy Loading**: When `GET /api/people/:id` is called, the server reads the source YAML file from disk to retrieve `scrapbook_md` and `_gedcom`, then merges them into the response. This is a single async `fs.readFile` + YAML parse — negligible latency for a detail-page request, but it keeps ~100MB+ of idle text out of the V8 heap.
- **What Stays In Memory**: `id`, `version`, `created`, `last_modified`, `names`, `sex`, `tags`, `relationships`, `events`, `assets`, and the volatile `_computed` cache. These fields are sufficient for graph traversal, edge reconciliation, search indexing, timeline slicing, and computed relationship derivation.
- **Monitoring**: `GET /system/status` should be extended (Phase 5+) to expose `heapUsedMB` from `process.memoryUsage()` so operators can monitor runtime memory consumption.
- **Scaling Ceiling**: With the Slim Node Strategy, the architecture comfortably serves datasets up to ~100,000 nodes within default V8 memory. Beyond that, further evolution (LRU eviction of event arrays, graph partitioning) would be needed — but this is well beyond typical genealogy datasets.

**C. Worker Thread Hydration**

Hydration is offloaded from the main event loop via `worker_threads`, allowing the Fastify server to start immediately and serve health checks while data is being loaded. This applies to **all** dataset sizes — even for modest datasets it ensures the server is never unresponsive during startup.

- **Strategy**: Use Node.js `worker_threads` to perform YAML parsing, Zod validation, and story loading in a background thread. The main thread remains responsive and serves `GET /system/status` with `hydrationState: "loading"` to clients.
- **503 During Loading**: While hydration is in progress, all API endpoints except `GET /system/status`, `GET /system/hydration/stream`, and auth endpoints (`POST /auth/login`, `POST /auth/logout`) return `503 Service Unavailable` with `{ error: "Graph is loading", code: "HYDRATION_IN_PROGRESS" }`.
- **Cache-Aware**: The worker performs the tiered cache comparison (Section 2.3A) internally — only stale files are re-parsed from YAML. Both full nuclear and incremental paths run inside the worker.
- **Handoff**: The worker serializes the validated node map, story list, and mtime entries back to the main thread via `postMessage` (structured clone). The main thread then performs the final Graphology graph construction, edge building, search indexing, and `_computed` relationship computation (which is fast, as it's just inserting pre-validated data).
- **Progress Reporting**: The worker emits `{ type: 'progress', phase, loaded, total, percent }` events via `parentPort.postMessage()` during file processing (every 50 files). The `GraphEngine` (which extends `EventEmitter`) relays these as `hydration:progress` events, emitting `hydration:complete` with `{ nodeCount, edgeCount, elapsedMs }` when finished. This feeds the SSE endpoint (`GET /system/hydration/stream`) for frontend progress display.
- **Fallback**: If the worker thread fails (e.g., crash, unhandled error), the engine automatically falls back to inline hydration on the main thread to guarantee startup.
- **Scope**: Worker Thread hydration is the **default boot strategy** (`hydrateInBackground()`). The inline `hydrate()` method is retained as a synchronous alternative for testing and simple usage. The BootLoader logic remains identical; only its execution context changes.

**D. Search Index Persistence**

FlexSearch indices are fully rebuilt from the graph during hydration. While the worker thread and `mtime` cache bypass YAML parsing, tokenizing and building a FlexSearch index for 50,000+ nodes on every boot is heavy CPU work that adds avoidable startup latency.

- **Serialization**: FlexSearch supports exporting and importing its compiled index. After hydration completes (and after any incremental hot-patch), the `SearchService` serializes its person index, story index, and place map to disk at `/_meta/.search-index.json`.
- **Incremental Boot**: On startup, if `/_meta/.search-index.json` exists and its `spec_version` matches the current schema version, the `SearchService` imports the pre-compiled index directly. Only nodes whose `mtime` changed (as determined by the tiered cache comparison in Section 2.3A) are surgically re-indexed — removed from the loaded index and re-added with fresh data.
- **Cache Invalidation**: The search index cache is invalidated (full rebuild triggered) when: (a) the file is missing, (b) `spec_version` mismatches, (c) JSON is corrupt, or (d) the user triggers `POST /system/rebuild`.
- **Storage Format**: `{ spec_version: string, exportedAt: string, personIndex: FlexSearchExport, storyIndex: FlexSearchExport, placeMap: Array<[string, string[]]> }`.
- **Hot-Patch Persistence**: After incremental hot-patch updates to the index (via `indexPerson()` / `removePerson()`), the updated index is re-serialized to disk on a debounced timer (same cadence as the graph cache write) to keep the on-disk index fresh without excessive I/O.

---

## **3. Data Layer Specification**

All data ingestion must pass strict Zod schemas. This ensures data integrity before it enters the runtime graph.

### **3.1 Person Schema (`/people/*.yaml`)**

**File Naming**: `N_[nanoid].yaml` (e.g., `N_7x9aZ2.yaml`).

| Field           | Type          | Description                                          |
| :-------------- | :------------ | :--------------------------------------------------- |
| `version`       | Literal "5.0" | Schema version for migration safety.                 |
| `id`            | String        | Unique ID, prefix `N_` + NanoID.                     |
| `created`       | ISO-8601      | Timestamp of creation.                               |
| `last_modified` | ISO-8601      | Timestamp of last edit.                              |
| `names`         | Array         | List of name objects.                                |
| `sex`           | Enum          | `M`, `F`, `I` (Intersex), `U` (Unknown).             |
| `tags`          | Array<String> | User-defined tags (e.g., "Civil War", "Immigrant").  |
| `relationships` | Object        | Stores **ONLY** upstream parents.                    |
| `events`        | Array         | Chronological life events (See 3.2).                 |
| `assets`        | Array<String> | Filenames of associated media. First item is Avatar. |
| `scrapbook_md`  | String        | Free-form Markdown for unstructured notes/scrapbook. |
| `_gedcom`       | Object        | Preserved unmapped tags from GEDCOM import.          |

**Detailed Schema Definition (Zod Notation):**

```typescript
{
  names: [{
    first: string,
    last: string,
    nickname?: string,
    primary?: boolean
  }],
  relationships: {
    parents: [{
      id: string, // Reference to Person ID
      type: "biological" | "adopted" | "step" | "foster"
    }]
  }
}
```

### **3.2 Event Architecture**

Events are typed objects acting as state reducers. They determine the "current status" of a person (especially for marriages).

**Base Event Fields**:

- `id`: String (NanoID).
- `date`: String (Fuzzy, e.g., "Bet. 1900 and 1910").
- `sort_date`: String (ISO-8601 strict: `YYYY-MM-DD`). Used for chronological ordering.
- `location`: String (Optional).
- `description`: String (Markdown supported, Optional).
- `assets`: Array<String> (Filenames).

**Supported Event Types**:

| Type         | Computed Logic / Extra Fields                                                         |
| :----------- | :------------------------------------------------------------------------------------ |
| `birth`      | Defines start of timeline.                                                            |
| `death`      | Defines end of timeline. Field: `cause` (string).                                     |
| `marriage`   | Links two people. Fields: `partner_id` (string), `status` (married/divorced/widowed). |
| `divorce`    | Terminates a marriage. Field: `partner_id` (string).                                  |
| `residence`  | Location history.                                                                     |
| `census`     | Census record. Field: `household_id` (string).                                        |
| `occupation` | Work history. Fields: `title`, `organization`.                                        |
| `education`  | Academic history. Fields: `institution`, `degree`.                                    |
| `baptism`    | Religious event.                                                                      |
| `burial`     | Final resting place.                                                                  |
| `generic`    | Custom events. Field: `title`.                                                        |

### **3.3 Asset Index (`/_meta/assets.yaml`)**

To avoid scanning thousands of binaries on boot, metadata is cached.

- **Structure**: Map of `Filename -> Metadata`.
- **Metadata**:
  - `id`: NanoID.
  - `caption`: String.
  - `date_taken`: ISO-8601.
  - `location`: String.
  - `type`: `image | video | pdf`.

---

## **4. Core Logic & Algorithms (The Brain)**

### **4.0 BootLoader & Integrity**

- **Responsibility**: Loads YAML files from disk.
- **Validation**:
  - **Schema**: Validates against Zod Schemas.
  - **Asset Integrity**: Verifies existence of files referenced in `assets` array. Logs warnings for missing files.

### **4.1 The Graph Engine (Runtime)**

- **Library**: `graphology`.
- **Graph Type**: Directed MultiGraph.
- **Nodes**: `Person`, `Story`.
- **Edges**:
  - `child_of`: From Person -> Parent.
  - `mentions`: From Story -> Person.

**Computed Relationships (Runtime)**:
These are **NOT** stored in YAML. They are derived via graph traversal and cached in volatile `_computed` node attributes.

1.  **Siblings**: `getSiblings(id)`.
    - Logic: Find parents -> Find all children of parents -> Filter `self`.
2.  **Spouses**: `getCurrentSpouse(id)`.
    - **"Henry VIII Algorithm"**:
      1.  Fetch all `marriage`, `divorce` events for Person.
      2.  Sort by `sort_date`.
      3.  Replay timeline: Marriage sets `current_spouse`, Divorce clears it.
      4.  Final check: If `current_spouse` exists, check their `death` events. If dead -> Status `widowed`.

**Graph-Level Memoization (`_computed` Cache)**:

Executing the Henry VIII traversal and sibling lookups on every API request degrades read performance. Instead, computed relationships are pre-calculated and cached:

- **Storage**: Each Graphology node carries a volatile `_computed` attribute (never serialized to YAML or the binary cache). Structure:
  ```typescript
  _computed: {
    currentSpouse: { id: string; status: "married" | "widowed" } | null;
    siblings: string[];     // Array of Person IDs
    children: string[];     // Array of Person IDs (reverse lookup)
    allSpouses: Array<{ id: string; status: string; sortDate: string }>;
  }
  ```
- **Population**: `_computed` is populated during hydration, immediately after all nodes and edges are loaded. The `GraphLogic` module exposes a `computeRelationships(nodeId)` function that writes results directly to the node attributes.
- **Invalidation**: When a file-watcher change event fires for a node, the engine recomputes `_computed` for **that node AND all immediate neighbors** (parents, children, spouses). This ensures a marriage event added to Person A also updates Person B's `_computed.currentSpouse`.
- **API Reads**: API endpoints read directly from `_computed` — no traversal at request time. This turns O(n) graph walks into O(1) attribute lookups.

**Diff-Based Edge Reconciliation (Hot-Patching)**:

The current hot-patching approach drops all outgoing edges and rebuilds them, which is imprecise and can miss stale incoming edges from neighbors.

- **Strategy**: When a YAML file changes, the engine compares the **old** parsed state (retained in memory from the previous hydration) against the **new** parsed state.
- **Reconciliation Steps**:
  1.  **Diff `relationships.parents`**: Compute the set difference between old and new parent IDs. Remove edges for dropped parents; add edges for new parents.
- **Neighbor Cascade**: After reconciling edges for the changed node, trigger `_computed` invalidation (see above) for all affected neighbors.
- **Fallback**: If the diff produces an inconsistent state (e.g., orphaned edges detected), fall back to a targeted "mini-hydration" that drops and rebuilds all edges for the affected node and its immediate neighborhood.

**Unified Write Side-Effects (`applyWriteSideEffects`)**:

All mutation paths — API write handlers and file watcher hot-patching — converge on a single `GraphEngine.applyWriteSideEffects(id, oldSlim, newSlim, bio)` method. This ensures consistency regardless of how a person is created or modified:

1.  **Edge Reconciliation**: If `oldSlim` is non-null, runs diff-based edge reconciliation (see above). If null (new node), adds all parent edges.
2.  **Search Indexing**: Calls `searchService.indexPerson(newSlim, bio)`.
3.  **`_computed` Invalidation**: Calls `invalidateComputed(graph, id)` for the node and all its neighbors.

The file watcher's `handleFileUpdate()` parses the YAML, updates the graph node, then calls `applyWriteSideEffects()`. API handlers (`POST /people`, `PUT /people/:id`) do the same after writing to disk. This eliminates the previous inconsistency where API-created persons were invisible to search and had no computed relationships.

**Story Hot-Patching**:

The file watcher monitors `stories/` for Markdown changes in addition to `people/` for YAML. Story handlers mirror the person hot-patch pipeline:

- **`handleStoryUpdate(filePath)`**: Parses the Markdown file (frontmatter via `gray-matter`, mentions via remark AST walk for `@N_xxx` and `[[N_xxx]]` patterns), adds/updates the story node in the graph (type: `story`), reconciles `mentions` edges to referenced persons, indexes in search via `indexStory()`, and invalidates `_computed` for mentioned persons (timeline changes).
- **`handleStoryRemove(filePath)`**: Drops the story node and all its edges from the graph, removes from the search index, and invalidates `_computed` for previously-mentioned persons.
- **Self-Write Dedup**: Story handlers also check the write-origin set, future-proofing for API-initiated story writes (Phase 5.1).

**Write-Event Deduplication (Self-Write Ignore)**:

When the API writes a file to disk (via `TransactionManager.writeFile()`), the `@parcel/watcher` file watcher detects the change and triggers the hot-patch handler, causing the engine to diff and reconcile edges for an update *it just made*. This is wasted CPU and can cause subtle race conditions during rapid edits.

- **Mechanism**: The `GraphEngine` maintains a transient **write-origin set** (`Set<string>`) of file paths that were written by the application itself (not by an external editor). When `TransactionManager.writeFile()` completes a disk write, it registers the absolute file path with the `GraphEngine`'s write-origin set.
- **Watcher Check**: When the file watcher fires an event, the hot-patch handler checks the write-origin set first. If the file path is present, the event is **consumed** (removed from the set) and the hot-patch is skipped — the graph is already up-to-date from the API handler that initiated the write.
- **External Edits Pass Through**: Changes made by a user editing YAML/Markdown in VS Code, or by `git checkout`, are not registered in the write-origin set and are processed normally by the hot-patch pipeline.
- **TTL Safety**: Entries in the write-origin set expire after 10 seconds to prevent memory leaks if a watcher event is lost or delayed. The TTL is conservative — `@parcel/watcher` typically fires within milliseconds.
- **File Watcher Circuit Breaker**: If the watcher fires a massive localized burst of events (e.g., >50 events in 500ms from `git checkout` or bulk find-and-replace), this indicates a "Massive External Edit". In this state, granular hot-patching is **suspended**. The system transitions `hydrationState` to `"loading"`, ignores further burst events, and triggers a background re-hydration (`hydrateInBackground()`) to rebuild the graph and caches cleanly without starving the Node.js event loop.

### **4.2 Timeline Slicer**

Pre-computes the "Integrated Feed" for the UI Person Detail page.

- **Input**: Person ID, optional pagination params (`limit`, `offset`).
- **Process**:
  1.  **Collection**: Merge Person Events + Story Mentions (Stories mentioning this person).
  2.  **Sorting**: Strict Sort by `sort_date`.
  3.  **Gap Detection**: Iterate sorted list. If `Item[i+1].year - Item[i].year > 10`, insert a `Gap` object: `{ type: 'gap', years: diff }`.
  4.  **Pagination**: Apply `offset` and `limit` to the final sorted array (after gap insertion). Return `totalCount` alongside the page slice.
- **Output**: `{ items: Array<Event | Story | Gap>, totalCount: number, offset: number, limit: number }`.

### **4.3 GEDCOM Engine**

- **Logic**:
  - **Import**: Stream Read -> Parse 5.5.1/7.0 -> Map Tags to Legacy Schemas -> Write YAMLs.
  - **Robustness Rules**:
    - **Date Parsing**: **MUST** use the shared `DateParser` utility (`src/utils/DateParser.ts`). Supports standard formats (`DD MMM YYYY`, `MMM YYYY`, `YYYY`) and modifiers (`ABT`, `EST`, `CAL`, `BEF`, `AFT`, `BET`, `FROM`/`TO`). Invalid dates fallback to standard ISO default.
    - **Relationships**: Must fully reconstruct parent-child links.
      - Iterate `FAM` records.
      - Map `HUSB` -> Father, `WIFE` -> Mother.
      - Iterate `CHIL` children.
      - Update Child's `relationships.parents` array with Father and Mother IDs.
  - **Export**: Walk Graph -> Serialize to strict GEDCOM format.
  - **Loss Prevention**: Unhandled tags go into `Person._gedcom`.

---

## **5. API Specification (Head 2 Server)**

**Framework**: Fastify (plugin-based route architecture).
**Base URL**: `/api`.
**Errors**: Standard JSON: `{ error: string, code: string, details?: any }`.

**Route Plugin Architecture**: The server is decomposed into Fastify route plugins (`src/api/routes/`): `people.ts`, `system.ts`, `search.ts`, `auth.ts`, `gedcom.ts`. Shared services (`GraphEngine`, `TransactionManager`, `AuthConfig`) are bound to the Fastify instance via `server.decorate('appServices', ...)` — eliminating module-level singletons and ensuring clean lifecycle management across test runs. The server orchestrator (`server.ts`) handles only plugin registration, Fastify decoration, and lifecycle hooks (~95 lines).

### **5.1 Entity Endpoints**

- `GET /people/:id`: Returns hydrated Person object (Schema Data + Computed Relations + Timeline).
  - **Query**: `?timeline_limit=50&timeline_offset=0` (optional, paginates the embedded timeline).
  - **Lazy Loading**: The `scrapbook_md` and `_gedcom` fields are **not** held in the in-memory graph (see Section 2.3B Slim Node Strategy). When this endpoint is called, the server reads the source YAML file from disk asynchronously, extracts these fields, and merges them into the response alongside the in-memory graph data and `_computed` relationships. This adds negligible latency (~1-5ms for a single file read) while keeping the V8 heap lean.
  - _404_: Person not found.
- `POST /people`: Create new Person.
  - _Body_: Partial Person Schema.
  - _Effect_: Writes new YAML, adds node to graph, applies full write-path side effects (parent edges, search indexing, `_computed` invalidation via `applyWriteSideEffects()`), returns ID. Enqueues change to debounced commit queue (see Section 7.1).
- `PUT /people/:id`: Update Person.
  - _Body_: Replacement Person Schema.
  - _Effect_: Captures old slim data for edge diff, overwrites YAML, applies full write-path side effects (edge reconciliation, search re-indexing, `_computed` invalidation for node + neighbors). Enqueues change to debounced commit queue (see Section 7.1).
- `PUT /people/:id/media`: Upload asset.
  - _Multipart_: File data.
  - _Effect_: Saves to `/assets`, updates Person YAML `assets` array, invalidates `_computed` for the person.
- `GET /assets/*`: Static Asset Delivery.
  - _Effect_: Serves files from the `/assets` directory. Uses HTTP Range requests for optimal media streaming (MP4) and injects strong caching headers (`Cache-Control: max-age=31536000, immutable`) powered by ETag/mtime comparisons to prevent Node event loop blocking.

### **5.2 Search & Discovery**

- `GET /search`:
  - **Query**: `?q=string&limit=50&offset=0`.
  - **Params**:
    - `q` (required): Search query string.
    - `limit` (optional, default `50`, max `200`): Maximum results per category.
    - `offset` (optional, default `0`): Pagination offset per category.
  - **Engine**: FlexSearch.
  - **Returns**: `{ people: [], stories: [], places: [], totalCounts: { people: number, stories: number, places: number } }`.

### **5.3 System Operations**

- `POST /system/snapshot`: Flush pending commits, create a Git Tag.
  - _Body_: `{ name: string }`.
- `POST /import/gedcom`: Bulk Import.
  - _Warning_: Destructive. Wipes current data directory (except `.git`).
- `GET /system/status`: Returns runtime health info. **Always available**, even during hydration (see 2.3C).
  - _Returns_: `{ nodeCount: number, edgeCount: number, hydrationState: "ready" | "loading", cacheAge: string | null }`.
  - _Note_: When `hydrationState` is `"loading"`, `nodeCount` and `edgeCount` are `0` until hydration completes.
- `GET /system/hydration/stream`: Server-Sent Events (SSE) stream of hydration progress. **Always available**.
  - _Content-Type_: `text/event-stream`.
  - _Events_: `{ event: "progress", data: { phase: string, loaded: number, total: number, percent: number } }`, `{ event: "complete", data: { nodeCount: number, edgeCount: number, elapsedMs: number } }`, `{ event: "error", data: { message: string } }`.
  - _Behavior_: If hydration is already complete when the client connects, immediately sends a `complete` event and closes. During loading, streams periodic `progress` events as the worker processes files, followed by a final `complete` event.
- `POST /system/rebuild`: Force a full Nuclear Hydration, bypassing the tiered cache.
  - _Effect_: Invalidates `/_meta/.graph-cache.json`, re-parses all YAML files, rebuilds graph and search index from scratch.

### **5.4 Authentication**

- `POST /auth/login`: Authenticate user.
  - _Body_: `{ username: string, password: string }`.
  - _Effect_: Validates against `/_meta/auth.yaml` (BCrypt). Returns JWT in HttpOnly Cookie.
  - _401_: Invalid credentials.
- `POST /auth/logout`: End session.
  - _Effect_: Clears HttpOnly Cookie.
- **Auth Guard**: All endpoints except `POST /auth/login`, `GET /system/status`, and `GET /system/hydration/stream` require a valid JWT.

---

## **6. User Experience (UI) Specification**

### **6.1 Architecture & Tooling**

- **Location**: `client/` directory within the monorepo. Separate Vite config, built independently. Production build output served by Fastify via `@fastify/static`.
- **Framework**: Vite + React 18 + TypeScript.
- **Routing**: TanStack Router (file-based routes).
- **Data Fetching**: TanStack Query — **all** API calls go through Query hooks with optimistic update wrappers from day one. Mutations use `onMutate` → optimistic cache update, `onError` → rollback, `onSettled` → invalidate.
- **UI State**: Zustand for UI-local state (sidebar collapsed, active panel, modal visibility, active tab). Keeps component tree clean; avoids prop-drilling and excessive Context providers.
- **Component Library**: shadcn/ui (Radix primitives + Tailwind CSS). Provides accessible, unstyled-by-default components with full style control. Import components as needed — no monolithic bundle.
- **CSS**: Tailwind CSS v4 with Dark Mode palette (Slate/Zinc/Neutral base). Custom design tokens for spacing, color, and typography via `tailwind.config.ts`.
- **Typography**: `Inter` (UI chrome), `Fira Code` (data fields, IDs, dates), `Merriweather` (story narrative content). Loaded via Google Fonts or self-hosted WOFF2.
- **Icons**: Lucide React (consistent, tree-shakeable icon set used by shadcn/ui).

### **6.2 Layout Strategy**

#### **6.2.1 Theme**

- **Dark Mode default** (high contrast). Light mode toggle deferred to Phase 5.
- **Design Language**: Clean, professional, data-dense. Think VS Code meets Grafana — no decoration for its own sake, no heritage textures. Every pixel serves information.

#### **6.2.2 App Shell**

```
┌─────────────────────────────────────────────────────┐
│  [Sidebar]  │              [Top Bar]                │
│             │  ┌──────────────────────────────────┐  │
│  Dashboard  │  │                                  │  │
│  People     │  │         [Page Content]           │  │
│  Import     │  │                                  │  │
│  Settings   │  │                                  │  │
│             │  └──────────────────────────────────┘  │
│  [Status]   │                                       │
└─────────────────────────────────────────────────────┘
```

- **Persistent Left Sidebar** (VS Code Activity Bar pattern):
  - Icons + labels for: **Dashboard**, **People**, **Import**, **Settings**.
  - System status indicator at bottom (node count, hydration state dot — green/amber/red).
  - Collapsible to icon-only mode via toggle button or responsive breakpoint.
- **Top Bar**:
  - Breadcrumb trail (e.g., `People / John Smith`).
  - **Cmd+K** search trigger button (magnifying glass icon + hotkey hint).
  - User avatar / logout button (when auth is active).
- **Responsive Behavior**:
  - `≥1280px`: Full sidebar with labels + page content.
  - `768px–1279px`: Icon-only sidebar (labels hidden), full page content.
  - `<768px`: Sidebar collapses to hamburger menu overlay. Single-column page layout.

#### **6.2.3 Route Structure**

| Route | Page | Description |
|:------|:-----|:------------|
| `/` | Dashboard | Stats panel, force graph visualization |
| `/people` | People Browse | Searchable/filterable list of all people |
| `/people/:id` | Person Detail | "Holy Grail" 3-column layout |
| `/import` | GEDCOM Import | Upload form, hydration progress |
| `/settings` | Settings | System status, auth config, cache management |
| `/search?q=` | Search Results | Full-page search results (linked from CmdK "View all") |

### **6.3 Component System**

#### **6.3.1 Base Components (shadcn/ui)**

Import and customize these shadcn/ui primitives:

- `Button`, `Input`, `Label`, `Textarea` — form controls
- `Dialog`, `Sheet` — modals and slide-over panels
- `DropdownMenu`, `ContextMenu` — action menus
- `Command` (cmdk) — Command Palette foundation
- `Tabs` — panel switchers (Context Panel, Settings page)
- `Badge` — relationship type indicators, tags
- `Tooltip`, `HoverCard` — info on hover / person preview
- `Separator`, `ScrollArea` — layout utilities
- `Skeleton` — loading states
- `Sonner` (toast) — optimistic update confirmations and error notifications
- `Resizable` — panel resizing (Holy Grail columns)

#### **6.3.2 Custom Components**

| Component | Description |
|:----------|:------------|
| `Avatar` | Person photo (from first `assets` entry via `/assets/`) or generated initials. Circular, multiple sizes (sm/md/lg). |
| `PersonChip` | Compact inline reference to a person: Avatar + Name + relationship type badge. Click → navigate to `/people/:id`. Hover → `HoverCard` with mini bio preview (name, dates, photo). |
| `EventCard` | Timeline item for a life event. Shows event type icon, date, location, description. Expand for details. Click to edit (inline or modal). |
| `StoryCard` | Timeline item for a story mention. Shows title, excerpt, mentioned persons. Click → expand/navigate. |
| `GapIndicator` | Visual break in timeline showing the year gap (e.g., "—— 15 years ——"). |
| `StatusDot` | Colored indicator: green (ready), amber (loading), red (error). Used in sidebar and top bar. |
| `HydrationProgress` | Full-screen overlay on boot. Connects to SSE stream, shows progress bar with phase/percent/node count. Fades out when `hydrationState === "ready"`. |

### **6.4 Command Palette (Cmd+K)**

The primary navigation and search tool. Built early — it drives all navigation and forces real search latency testing against the paginated `/api/search` endpoint.

- **Trigger**: Global hotkey `Cmd+K` / `Ctrl+K`, or click the search button in the Top Bar.
- **Foundation**: shadcn/ui `Command` component (wraps `cmdk` library).
- **Behavior**:
  1. On open: Focus input, show recent/suggested items.
  2. On keystroke: Debounced input (300ms) queries `GET /api/search?q=...&limit=20`.
  3. Results rendered in categorized sections: **People** (with Avatar), **Stories**, **Places**.
  4. Keyboard navigation: `↑`/`↓` arrows, `Enter` to select, `Escape` to close.
  5. On select: Navigate to `/people/:id` (person), story detail (story), or filtered search (place).
  6. Footer action: "View all results →" links to `/search?q=...` full-page results.

### **6.5 The "Holy Grail" Person Detail Page**

A dense, 3-column layout. The most critical view in the application.

```
┌──────────────┬──────────────────────┬──────────────┐
│   Identity   │      Timeline        │   Context    │
│   (Left)     │      (Center)        │   (Right)    │
│              │                      │              │
│  [Avatar]    │  ┌────────────────┐  │ [Tabs]       │
│  Name ✏️     │  │ Birth 1842     │  │ Assets|Notes │
│  Birth-Death │  │ Marriage 1867  │  │              │
│  ──────────  │  │ ── 12 years── │  │ [Asset Grid] │
│  Parents     │  │ Census 1880   │  │              │
│    [Chip]    │  │ Story: "The.."│  │ [Scrapbook]  │
│  Spouses     │  │ Death 1910    │  │              │
│    [Chip]    │  └────────────────┘  │ [Raw YAML]   │
│  Children    │                      │              │
│    [Chip]    │  [+ Add Event]       │              │
│  Siblings    │                      │              │
│    [Chip]    │                      │              │
│  ──────────  │                      │              │
│  Tags        │                      │              │
└──────────────┴──────────────────────┴──────────────┘
```

#### **6.5.1 Panel Behavior**

- **All three columns are collapsible and resizable** via drag handles (shadcn/ui `Resizable` / `react-resizable-panels`).
- Default proportions: ~20% / 50% / 30%.
- Collapsed state saved to Zustand store (persists across navigation within session).
- Responsive: On `<1024px`, right panel collapses to a bottom sheet. On `<768px`, single-column stacked layout with tab navigation between panels.

#### **6.5.2 Identity Panel (Left)**

- **Avatar**: Large circular photo (first `assets` entry) or generated initials.
- **Name**: Primary name displayed prominently. **Click-to-edit** — inline text field, saves via `PUT /people/:id` with optimistic update. Other names shown below in muted text.
- **Vital Dates**: Birth–Death date range. Click-to-edit.
- **Sex**: Badge indicator (M/F/I/U).
- **Relationship Sections** (from `_computed`): Collapsible groups for Parents, Spouses, Children, Siblings. Each person rendered as a `PersonChip`:
  - **Hover**: `HoverCard` shows mini bio preview — avatar, name, birth–death dates, relationship type.
  - **Click**: Navigate to `/people/:id` for that person.
- **Tags**: Inline editable tag list with add/remove.

#### **6.5.3 Timeline Feed (Center)**

The integrated feed of life events, stories, and gaps. **Virtualized** — only visible items rendered via `@tanstack/react-virtual`.

- **Data Source**: `GET /people/:id?timeline_limit=50&timeline_offset=0`. Uses TanStack Query `useInfiniteQuery` for infinite-scroll pagination.
- **Item Types**:
  - `EventCard`: Displays event type icon, date (fuzzy `date` + sort-date), location, description excerpt. Expandable for full detail.
  - `StoryCard`: Title, excerpt, mentioned persons chips.
  - `GapIndicator`: Visual break showing year gap.
- **Add Event**: Floating action button or "+" button at bottom of timeline. Opens the Event Editor modal.
- **Edit Event**: Click an `EventCard` to open the Event Editor modal pre-filled with that event's data.

#### **6.5.4 Context Panel (Right)**

Tabbed panel with three tabs:

1. **Assets**: Grid of thumbnails (from `/assets/` static delivery). Click to expand/lightbox. Drag-and-drop upload via `PUT /people/:id/media`.
2. **Notebook**: Rendered Markdown view of `scrapbook_md` (lazy-loaded per spec 2.3B). Click to switch to edit mode — embedded Markdown editor (Phase 4: basic `<textarea>` with preview; Phase 5.1: Tiptap rich editor). Saves via `PUT /people/:id` with optimistic update.
3. **Raw YAML**: Read-only syntax-highlighted view of the source YAML file. Useful for power users and debugging.

#### **6.5.5 Event Editor**

Full modal-based event editor for creating and editing all 11 event types. This is the primary data entry surface.

- **Trigger**: "Add Event" button or clicking an existing event card.
- **Layout**: Modal (`Dialog`) with:
  - **Event Type Selector**: Dropdown with all 11 types. Selecting a type dynamically shows/hides type-specific fields (e.g., `partner_id` for marriage, `cause` for death, `institution`/`degree` for education).
  - **Common Fields**: `date` (free text, fuzzy), `sort_date` (date picker enforcing `YYYY-MM-DD`), `location` (text input with place autocomplete from place map), `description` (Markdown textarea), `assets` (file selector).
  - **Type-Specific Fields**: Rendered conditionally based on selected event type (see spec Section 3.2).
  - **Partner Selection** (marriage/divorce): Searchable person selector that queries the graph — type-ahead with `PersonChip` results.
- **Validation**: Client-side Zod validation mirroring the backend `EventSchema`. Show field-level errors immediately.
- **Save**: `PUT /people/:id` with the updated events array. Optimistic update via TanStack Query mutation.

#### **6.5.6 Relationship Editor**

For editing parent relationships (the only stored relationships per spec Section 3.1).

- **Location**: Section within the Identity Panel, or accessible via "Edit Relationships" button.
- **Add Parent**: Searchable person selector (same component as partner selection). Select relationship type (biological/adopted/step/foster).
- **Remove Parent**: Confirm dialog before removing.
- **Save**: `PUT /people/:id` with updated `relationships.parents` array. Backend handles edge reconciliation and `_computed` invalidation.

### **6.6 People Browse Page**

Searchable, sortable table/list of all people in the graph. Entry point from the sidebar.

- **Data Source**: Requires a new `GET /api/people` list endpoint (see Section 6.10 below). Returns paginated slim person summaries.
- **Layout**: Dense table with columns: Avatar, Name, Birth Date, Death Date, Tags, # Events. Sortable by any column.
- **Search**: Inline filter bar at top (uses same search endpoint, but rendered as a table rather than CmdK dropdown).
- **Click Row**: Navigate to `/people/:id`.
- **Bulk Actions** (Phase 5+): Multi-select for tagging, exporting.
- **Virtualization**: Table body uses `@tanstack/react-virtual` for large datasets.

### **6.7 Dashboard**

The landing page. Overview of the family graph.

- **Stats Panel**: Cards showing Total People, Total Families (derived from marriage events), Last Edited File (from git log or `last_modified`), System Status.
- **Force Graph Visualization**: Interactive 2D graph visualization using `react-force-graph-2d`. Nodes = people, edges = parent-child + spouse relationships. Click a node → navigate to `/people/:id`.
- **"Gravity Bands"** (Phase 5): Position nodes vertically by birth year, creating generational layers.

### **6.8 Import & Settings Pages**

#### **6.8.1 Import Page**

- **GEDCOM Upload**: Drag-and-drop file zone. Accepts `.ged` files.
- **Warning**: Clear destructive action warning ("This will replace all existing data. Git history is preserved.").
- **Progress**: After upload, connect to `GET /system/hydration/stream` SSE and show real-time progress bar (phase, percent, node count).
- **Completion**: On `complete` event, redirect to Dashboard with success toast showing node count.

#### **6.8.2 Settings Page**

- **System Status**: Live display of `GET /system/status` data — node count, edge count, hydration state, cache age.
- **Cache Management**: "Force Rebuild" button → `POST /system/rebuild`. Shows progress via SSE.
- **Snapshot**: "Create Snapshot" → `POST /system/snapshot`. Input for snapshot name.
- **Authentication** (when active): Current user display, logout button.

### **6.9 Technical Constraints (Mandatory)**

These constraints are non-negotiable for any data-dense genealogy UI:

1.  **Virtualization is Mandatory**: The Timeline Feed, Search Results, and People Browse table must use virtual scrolling (`@tanstack/react-virtual`). DOM nodes are only rendered for visible items. This is critical for datasets with thousands of events or search results.
2.  **Optimistic UI with TanStack Query**: Because the backend uses a debounced Git queue (Section 7.1), writes have slight latency. The React UI must use optimistic updates: update local React Query cache immediately on user action, send the `PUT`/`POST`, and only roll back if the API returns an error. Toast notifications (Sonner) confirm success or show rollback errors.
3.  **Hydration-Aware Shell**: The app shell must handle the 503 loading gate gracefully. On boot, connect to `GET /system/hydration/stream` (SSE) and display `HydrationProgress` overlay. Do not render data-dependent views until `hydrationState === "ready"`.
4.  **Typed API Client**: A shared `client/src/api/` layer with typed fetch wrappers for every backend endpoint. Types shared or mirrored from the backend Zod schemas to ensure compile-time safety.
5.  **Responsive Design**: All pages must function on desktop (≥1280px), tablet (768px–1279px), and mobile (<768px) viewports. The sidebar, Holy Grail panels, and tables adapt as specified in 6.2.2 and 6.5.1.

### **6.10 API Additions Required for Frontend**

The following backend additions are needed to support the frontend views:

- **`GET /api/people`**: Paginated list of all people (slim summaries). Query params: `?limit=50&offset=0&sort=last_modified&order=desc`. Returns `{ people: SlimPersonSummary[], totalCount: number }`. Each summary: `{ id, names, sex, birthDate?, deathDate?, tags, assetCount }`.
- **`GET /api/stats`** (or extend `GET /system/status`): Dashboard stats — total people, total families (marriage event count), last modified timestamp.

---

## **7. Operational & Security Layer**

### **7.1 Git Operations**

- **Middleware**: "Auto-Commit". Every write operation (`PUT`, `POST`) results in a Git commit that captures the change.

**Debounced Commit Queue**:

The `TransactionManager` uses `isomorphic-git` (pure JavaScript, in-process) for all programmatic Git operations, avoiding child-process overhead:

- **Commit Window**: File writes are queued. After the last write in a burst, a **5-second debounce timer** starts. When the timer fires, all pending changes are committed in a single atomic Git commit via `isomorphic-git`.
- **Commit Message**: Batched commits use a summary message: `"Update N files: Person X, Person Y, ..."` (truncated at 72 chars for Git convention).
- **Flush on Demand**: The API exposes a mechanism to force an immediate flush (e.g., before a snapshot or on graceful shutdown), bypassing the debounce window.
- **Graceful Shutdown Flush**: Node process `SIGTERM`/`SIGINT` signals are trapped. The application blocks shutdown until `TransactionManager.destroy()` finishes flushing any buffered `isomorphic-git` commits, preventing data loss.
- **Mutex Retained**: The global Mutex still protects concurrent write access to the file system. The debounce only affects when `git commit` is invoked, not when files are written.

**isomorphic-git (Complete — Phase 3.6)**:

- **Status**: ✅ Complete. All programmatic Git operations (`add`, `commit`, `tag`, `log`) use `isomorphic-git`, a pure JavaScript Git implementation running entirely in the Node.js process. No child processes are spawned for Git operations.
- **Rationale**: The previous `simple-git` approach shelled out to the OS Git binary for every operation, incurring process-spawn overhead. `isomorphic-git` eliminates this entirely.
- **Scope**: The user's system Git remains available for manual CLI use and is unaffected.
- **Tradeoff**: `isomorphic-git` does not support every Git feature (e.g., advanced merge strategies). For operations like `push`/`pull` (future network sync), fall back to spawning system Git.

### **7.2 Authentication**

- **Local-First Auth**:
  - Credentials stored in `/_meta/auth.yaml` (BCrypt).
  - JWT Session (HttpOnly Cookie).

---

## **8. Implementation Roadmap**

Implementation status, phase-by-phase progress, and the detailed task backlog are tracked in **`progress.md`**.

This spec defines _what_ to build. `progress.md` tracks _how far_ and _what's next_.

---

## **9. Comprehensive Test Strategy**

### **9.1 Unit Tests (Vitest)**

*   **GEDCOM**: Verify parsing of 5.5.1 and 7.0 specific tags. Verify export round-trip preserves `_gedcom` tags.
*   **Search**: Verify fuzzy matching for typos in names. Verify pagination (`limit`, `offset`) returns correct slices and `totalCounts`.
*   **Timeline**: Verify Gap Detection logic. Verify pagination returns correct slices with `totalCount`.
*   **Schemas**: Verify Zod schemas reject invalid data and accept new fields (`scrapbook_md`, `_gedcom`).
*   **Computed Cache (`_computed`)**: Verify `computeRelationships()` populates correct spouse, sibling, and children data. Verify invalidation recomputes only affected nodes and neighbors.
*   **Edge Reconciliation**: Verify diff-based patching adds/removes exact edges for parent and marriage changes without touching unrelated edges.
*   **Graph Cache**: Verify cache hit skips YAML parsing. Verify stale `mtime` triggers selective re-parse. Verify missing/corrupt cache triggers full Nuclear Hydration.
*   **TransactionManager**: Verify debounced batching collapses rapid writes into a single commit. Verify flush-on-demand bypasses the debounce window. Verify `isomorphic-git` operations run in-process (no child-process spawning).
*   **SearchService Hot-Patch**: Verify incremental index update on node change. Verify index removal on node unlink.
*   **Worker Thread Hydration**: Verify worker function produces identical people/story output as inline BootLoader. Verify `hydrateInBackground()` completes and populates graph to same state as `hydrate()`. Verify `hydrationState` transitions correctly. Verify API returns 503 during loading for non-exempt endpoints.
*   **File Watcher (`@parcel/watcher`)**: Verify watcher detects add, change, unlink events for both `people/` and `stories/` directories. Verify subscription cleanup on shutdown. Verify story creation adds graph node with mentions edges. Verify story update refreshes metadata and edges. Verify story deletion removes node and edges from graph + search index.
*   **Slim Node Strategy**: Verify `scrapbook_md` and `_gedcom` are stripped from in-memory Graphology node `data` attribute after hydration. Verify graph cache serializes only slim data. Verify `GET /people/:id` returns full data (including `scrapbook_md` and `_gedcom`) by lazy-loading from disk. Verify search indexing still works without `scrapbook_md` in memory (bio field sourced during indexing, not from node attribute).
*   **Search Index Persistence**: Verify `SearchService.export()` serializes index to `/_meta/.search-index.json`. Verify `SearchService.import()` loads pre-compiled index and produces identical search results. Verify incremental boot only re-indexes nodes with changed `mtime`. Verify corrupt/missing index triggers full rebuild. Verify `spec_version` mismatch triggers full rebuild.
*   **Search Performance**: Verify `trackedPersonIds` and `trackedStoryIds` use `Set<string>` semantics (O(1) add/has). Verify FlexSearch limit bounds engine output correctly for paginated queries.
*   **Write-Event Deduplication**: Verify API-initiated writes register file path in the write-origin set. Verify file watcher skips hot-patch for self-written files (consumes entry from set). Verify external edits (not in write-origin set) are processed normally. Verify write-origin entries expire after TTL.

### **9.2 Integration Tests (Supertest)**

*   **Media Upload**: Test multipart upload -> FS write -> YAML update.
*   **Snapshots**: Trigger snapshot -> Verify git tag exists. Verify pending commits are flushed before tagging.
*   **Graph Hydration**: Verify `BootLoader` correctly populates the `GraphEngine`.
*   **API `_computed` Contract**: Verify `GET /people/:id` returns pre-computed relationships without triggering on-the-fly traversal.
*   **System Status**: Verify `GET /system/status` returns accurate node/edge counts and hydration state.
*   **System Rebuild**: Verify `POST /system/rebuild` invalidates cache and triggers full re-hydration.
*   **Hydration SSE Stream**: Verify `GET /system/hydration/stream` sends `progress` events during loading and a `complete` event when finished. Verify immediate `complete` if already hydrated.
*   **Search Pagination**: Verify `GET /search?q=...&limit=10&offset=5` returns correct paginated slices with `totalCounts`.
*   **API Write Side Effects**: Verify `POST /people` indexes new person in search immediately. Verify `POST /people` with parents wires parent edges in graph and populates `_computed.children` on parent. Verify `PUT /people/:id` updates search index with new name. Verify `PUT /people/:id` with marriage event recomputes `_computed.currentSpouse` for neighbors.
*   **Authentication**: Verify login returns HttpOnly JWT cookie. Verify protected endpoints reject unauthenticated requests. Verify logout clears session.

### **9.3 E2E Tests (Playwright)**

*   **CUJ: Import Flow**: Upload GEDCOM -> Wait for Hydration -> Verify Node Count.
*   **CUJ: Holy Grail**: Navigate to Person -> Edit Note -> Save -> Verify Persistence.
*   **CUJ: Time Tunnel**: Load view -> Scroll -> Verify Camera Z position changes.

