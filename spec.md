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
  - **Hot-Patching**: `chokidar` watches the disk. Granular handlers (`add`, `change`, `unlink`) update/patch specific nodes in <100ms without full reloads. Edge updates use a **Diff-Based Reconciliation** strategy (see 4.1).
  - **Indexing**: FlexSearch (In-Memory) for full-text search. Rebuilt on hydration and incrementally updated during hot-patching.
  - **Computed Cache**: Derived relationships (spouses, siblings) are pre-computed and stored as volatile `_computed` attributes on Graphology nodes, invalidated surgically on change events (see 4.1).

### **2.3 Performance Architecture: Tiered Hydration & Scaling**

The Dual-Head pattern is elegant for small to medium datasets but requires deliberate scaling strategies to avoid bottlenecks as the graph grows beyond thousands of nodes.

**A. Tiered Cache Model**

Nuclear Hydration (parsing and Zod-validating every YAML on boot) scales linearly with dataset size. For large datasets (10,000+ people), this blocks the Node.js event loop and delays startup.

- **Binary Cache**: An intermediate serialized cache (JSON blob at `/_meta/.graph-cache.json`) sits between YAML files and the Graphology runtime. On boot, the engine checks if the cache exists and is fresh.
- **Incremental Rebuild**: The cache stores the `mtime` (last modified time) of every source YAML file. On boot, only files whose `mtime` is newer than the cached entry are re-parsed from YAML. All other nodes load directly from the pre-validated cache.
- **Cache Invalidation**: The cache is considered stale and triggers full Nuclear Hydration when: (a) the cache file is missing, (b) the `spec_version` in the cache header does not match the current schema version, or (c) the user explicitly requests a full rebuild via the API.

**B. Worker Thread Hydration**

For datasets large enough that even incremental parsing is noticeable (50,000+ nodes), hydration is offloaded from the main event loop:

- **Strategy**: Use Node.js `worker_threads` to perform YAML parsing, Zod validation, and FlexSearch indexing in a background thread. The main thread remains responsive and can serve a "loading" status to clients.
- **Handoff**: The worker serializes the validated node map and edge list back to the main thread via `postMessage`. The main thread then performs the final Graphology graph construction (which is fast, as it's just inserting pre-validated data).
- **Scope**: Worker Thread hydration is an **optimization layer**, not a replacement. The BootLoader logic remains identical; only its execution context changes.

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
- **Invalidation**: When a `chokidar` change event fires for a node, the engine recomputes `_computed` for **that node AND all immediate neighbors** (parents, children, spouses). This ensures a marriage event added to Person A also updates Person B's `_computed.currentSpouse`.
- **API Reads**: API endpoints read directly from `_computed` — no traversal at request time. This turns O(n) graph walks into O(1) attribute lookups.

**Diff-Based Edge Reconciliation (Hot-Patching)**:

The current hot-patching approach drops all outgoing edges and rebuilds them, which is imprecise and can miss stale incoming edges from neighbors.

- **Strategy**: When a YAML file changes, the engine compares the **old** parsed state (retained in memory from the previous hydration) against the **new** parsed state.
- **Reconciliation Steps**:
  1.  **Diff `relationships.parents`**: Compute the set difference between old and new parent IDs. Remove edges for dropped parents; add edges for new parents.
  2.  **Diff `events` (marriage/divorce)**: Compute the set difference of `partner_id` references. Remove/add `spouse_of` implicit links accordingly.
  3.  **Diff `assets`**: Update asset-reference edges only for changed entries.
- **Neighbor Cascade**: After reconciling edges for the changed node, trigger `_computed` invalidation (see above) for all affected neighbors.
- **Fallback**: If the diff produces an inconsistent state (e.g., orphaned edges detected), fall back to a targeted "mini-hydration" that drops and rebuilds all edges for the affected node and its immediate neighborhood.

### **4.2 Timeline Slicer**

Pre-computes the "Integrated Feed" for the UI Person Detail page.

- **Input**: Person ID.
- **Process**:
  1.  **Collection**: Merge Person Events + Story Mentions (Stories mentioning this person).
  2.  **Sorting**: Strict Sort by `sort_date`.
  3.  **Gap Detection**: Iterate sorted list. If `Item[i+1].year - Item[i].year > 10`, insert a `Gap` object: `{ type: 'gap', years: diff }`.
- **Output**: `Array<Event | Story | Gap>`.

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

**Framework**: Fastify.
**Base URL**: `/api`.
**Errors**: Standard JSON: `{ error: string, code: string, details?: any }`.

### **5.1 Entity Endpoints**

- `GET /people/:id`: Returns hydrated Person object (Schema Data + Computed Relations + Timeline).
  - _404_: Person not found.
- `POST /people`: Create new Person.
  - _Body_: Partial Person Schema.
  - _Effect_: Writes new YAML, returns ID.
- `PUT /people/:id`: Update Person.
  - _Body_: Replacement Person Schema.
  - _Effect_: Overwrites YAML. Enqueues change to debounced commit queue (see Section 7.1).
- `PUT /people/:id/media`: Upload asset.
  - _Multipart_: File data.
  - _Effect_: Saves to `/assets`, updates Person YAML `assets` array.

### **5.2 Search & Discovery**

- `GET /search`:
  - **Query**: `?q=string`.
  - **Engine**: FlexSearch.
  - **Returns**: `{ people: [], stories: [], places: [] }`.

### **5.3 System Operations**

- `POST /system/snapshot`: Flush pending commits, create a Git Tag.
  - _Body_: `{ name: string }`.
- `POST /import/gedcom`: Bulk Import.
  - _Warning_: Destructive. Wipes current data directory (except `.git`).
- `GET /system/status`: Returns runtime health info.
  - _Returns_: `{ nodeCount: number, edgeCount: number, hydrationState: "ready" | "loading", cacheAge: string | null }`.
- `POST /system/rebuild`: Force a full Nuclear Hydration, bypassing the tiered cache.
  - _Effect_: Invalidates `/_meta/.graph-cache.json`, re-parses all YAML files, rebuilds graph and search index from scratch.

### **5.4 Authentication**

- `POST /auth/login`: Authenticate user.
  - _Body_: `{ username: string, password: string }`.
  - _Effect_: Validates against `/_meta/auth.yaml` (BCrypt). Returns JWT in HttpOnly Cookie.
  - _401_: Invalid credentials.
- `POST /auth/logout`: End session.
  - _Effect_: Clears HttpOnly Cookie.
- **Auth Guard**: All endpoints except `POST /auth/login` and `GET /system/status` require a valid JWT.

---

## **6. User Experience (UI) Roadmap**

_Note: UI implementation is Phase 4. This section is a design reference._

### **6.1 Layout Strategy**

- **Theme**: Dark Mode default (High Contrast).
- **Global Command Palette (Cmd+K)**: The primary navigation tool.

### **6.2 "The Holy Grail" Detail Page**

A dense, 3-column layout:

1.  **Identity (Left)**: Static bio, stats, relationship chips (Parents/Spouses/Children).
2.  **Timeline (Center)**: The "Feed" of life events, stories, and gaps.
3.  **Context (Right)**: Assets grid, Markdown Notebook (`scrapbook_md`), Raw YAML tab.

---

## **7. Operational & Security Layer**

### **7.1 Git Operations**

- **Middleware**: "Auto-Commit". Every write operation (`PUT`, `POST`) results in a Git commit that captures the change.

**Debounced Commit Queue**:

Spawning a child process via `simple-git` for every discrete save creates massive I/O latency during rapid edits or bulk updates. The `TransactionManager` implements a batching strategy:

- **Commit Window**: File writes are queued. After the last write in a burst, a **5-second debounce timer** starts. When the timer fires, all pending changes are committed in a single atomic Git commit.
- **Commit Message**: Batched commits use a summary message: `"Update N files: Person X, Person Y, ..."` (truncated at 72 chars for Git convention).
- **Flush on Demand**: The API exposes a mechanism to force an immediate flush (e.g., before a snapshot or on graceful shutdown), bypassing the debounce window.
- **Mutex Retained**: The global Mutex still protects concurrent write access to the file system. The debounce only affects when `git commit` is invoked, not when files are written.

**isomorphic-git Migration**:

- **Rationale**: `simple-git` shells out to the OS Git binary for every operation, incurring process-spawn overhead. `isomorphic-git` is a pure JavaScript Git implementation that runs entirely in the Node.js process — dramatically faster for high-frequency programmatic commits.
- **Scope**: Replace `simple-git` with `isomorphic-git` for all programmatic operations (`add`, `commit`, `tag`, `log`). The user's system Git remains available for manual CLI use and is unaffected.
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
*   **Search**: Verify fuzzy matching for typos in names.
*   **Timeline**: Verify Gap Detection logic.
*   **Schemas**: Verify Zod schemas reject invalid data and accept new fields (`scrapbook_md`, `_gedcom`).
*   **Computed Cache (`_computed`)**: Verify `computeRelationships()` populates correct spouse, sibling, and children data. Verify invalidation recomputes only affected nodes and neighbors.
*   **Edge Reconciliation**: Verify diff-based patching adds/removes exact edges for parent and marriage changes without touching unrelated edges.
*   **Graph Cache**: Verify cache hit skips YAML parsing. Verify stale `mtime` triggers selective re-parse. Verify missing/corrupt cache triggers full Nuclear Hydration.
*   **TransactionManager**: Verify debounced batching collapses rapid writes into a single commit. Verify flush-on-demand bypasses the debounce window.
*   **SearchService Hot-Patch**: Verify incremental index update on node change. Verify index removal on node unlink.

### **9.2 Integration Tests (Supertest)**

*   **Media Upload**: Test multipart upload -> FS write -> YAML update.
*   **Snapshots**: Trigger snapshot -> Verify git tag exists. Verify pending commits are flushed before tagging.
*   **Graph Hydration**: Verify `BootLoader` correctly populates the `GraphEngine`.
*   **API `_computed` Contract**: Verify `GET /people/:id` returns pre-computed relationships without triggering on-the-fly traversal.
*   **System Status**: Verify `GET /system/status` returns accurate node/edge counts and hydration state.
*   **System Rebuild**: Verify `POST /system/rebuild` invalidates cache and triggers full re-hydration.
*   **Authentication**: Verify login returns HttpOnly JWT cookie. Verify protected endpoints reject unauthenticated requests. Verify logout clears session.

### **9.3 E2E Tests (Playwright)**

*   **CUJ: Import Flow**: Upload GEDCOM -> Wait for Hydration -> Verify Node Count.
*   **CUJ: Holy Grail**: Navigate to Person -> Edit Note -> Save -> Verify Persistence.
*   **CUJ: Time Tunnel**: Load view -> Scroll -> Verify Camera Z position changes.

