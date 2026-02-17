# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. For the _what_ and _why_, see `spec.md`.
> For the _how far_ and _what's next_, read this document.

**Last Updated**: 2026-02-16
**Test Suite**: 154 passing, 0 skipped (154 total)
**Overall Completion**: ~65% of full spec

---

## 1. Phase Summary

| Phase | Description | Status |
|:------|:------------|:-------|
| **1 & 2** | Core Logic (Schemas, Graph, BootLoader) | ✅ Complete |
| **3.1** | Search Infrastructure | ✅ Complete |
| **3.2** | GEDCOM Interchange | ✅ Complete |
| **3.3** | Media Services | ✅ Complete |
| **3.4** | API Server & Auth | ✅ Complete |
| **3.5** | Backend Optimizations (7 items) | ✅ Complete (all 7 items) |
| **3.6** | Production Hardening (3 items) | ✅ Complete (all 3 items) |
| **4** | Frontend (React UI) + E2E Tests | ❌ Not started — **NEXT** |
| **5** | Immersion & Polish | ❌ Not started |
| **6** | Distribution & Deployment | ❌ Not started |

---

## 2. Detailed Implementation Status

### Phase 1 & 2: Core Logic — COMPLETE ✅

All foundational modules are implemented and tested.

| Module | File | Tests | Notes |
|:-------|:-----|:------|:------|
| BootLoader | `src/core/BootLoader.ts` | `tests/core/BootLoader.test.ts` ✅ (1) | YAML parsing via Zod, `p-limit` concurrency, asset integrity checks |
| GraphEngine | `src/core/GraphEngine.ts` | `tests/core/GraphEngine.test.ts` ✅ (1) | Graphology directed multigraph, `hydrate()`, `startWatcher()` via @parcel/watcher |
| GraphLogic | `src/core/GraphLogic.ts` | `tests/core/GraphLogic.test.ts` ✅ (2) | Henry VIII spouse algorithm, `getSiblings`, `getAggregatedAssets` |
| PersonSchema | `src/schemas/PersonSchema.ts` | `tests/schemas/PersonSchema.test.ts` ✅ (3) | All v5.0 fields including `scrapbook_md`, `_gedcom` |
| EventSchema | `src/schemas/EventSchema.ts` | `tests/schemas/EventSchema.test.ts` ✅ (2) | Discriminated union, all 11 event types |
| StorySchema | `src/schemas/StorySchema.ts` | `tests/schemas/StorySchema.test.ts` ✅ (1) | Markdown frontmatter schema |
| AssetSchema | `src/schemas/AssetSchema.ts` | `tests/schemas/AssetSchema.test.ts` ✅ (1) | Asset metadata schema |
| SchemaExpansion | (cross-schema) | `tests/schemas/SchemaExpansion.test.ts` ✅ (6) | Validates `scrapbook_md`, `_gedcom`, all event type variants |
| StoryLoader | `src/core/StoryLoader.ts` | `tests/core/StoryLoader.test.ts` ✅ (1) | Markdown + `@mention`/`[[wikilink]]` extraction |
| TransactionManager | `src/core/TransactionManager.ts` | `tests/core/TransactionManager.test.ts` ✅ (1) | Mutex + isomorphic-git (in-process, debounced batching) |
| DateParser | `src/utils/dateParser.ts` | `tests/utils/DateParser.test.ts` ✅ (4) | Shared GEDCOM date parsing utility |
| Hot-Patching | (in GraphEngine) | `tests/core/GraphEngineHotPatch.test.ts` ✅ (4) | Add, change, unlink, edge updates |
| Watcher | (in GraphEngine) | `tests/core/Watcher.test.ts` ✅ (5) | @parcel/watcher — add, change, delete, cleanup, migration verification |

**Known deviations from spec** (resolved in Phase 3.5):
- ~~Hot-patching uses "drop all outgoing edges and rebuild" rather than diff-based reconciliation (spec 4.1) → 3.5.4~~ **RESOLVED**
- ~~`_computed` attributes are not populated during hydration (spec 4.1) → 3.5.2~~ **RESOLVED**
- ~~TransactionManager is minimal (one commit per write, no debouncing) (spec 7.1) → 3.5.1~~ **RESOLVED**
- ~~`isomorphic-git` migration deferred (still uses `simple-git`) → Elevated to Phase 3.6.1 (immediate, before frontend)~~

---

### Phase 3.1: Search Infrastructure — COMPLETE ✅

| Item | Status |
|:-----|:-------|
| FlexSearch Document index | ✅ Implemented |
| Person indexing (names, nickname, bio, locations) | ✅ Working |
| `rebuild(graph)` on hydration | ✅ Wired |
| `indexPerson()` / `removePerson()` for hot-patching | ✅ Implemented |
| **Story indexing** | ✅ Implemented (Phase 3.5.6) |
| **Place search** | ✅ Implemented (Phase 3.5.6) |

**File**: `src/core/SearchService.ts` | **Tests**: `tests/core/SearchService.test.ts` (10 passing)

---

### Phase 3.2: GEDCOM Interchange — COMPLETE ✅

| Item | Status |
|:-----|:-------|
| Custom GEDCOM parser | ✅ `src/core/gedcom/Import.ts` |
| INDI → PersonSchema mapping | ✅ |
| FAM → Marriage Event + Parent-Child links | ✅ |
| `_gedcom` loss prevention | ✅ |
| GEDCOM 5.5.1 Exporter | ✅ `src/core/gedcom/Export.ts` |
| Round-trip verification | ✅ `tests/core/gedcom/RoundTrip.test.ts` |
| Date parsing robustness | ✅ Shared `DateParser` utility |

**Tests**: 16 passing across Import (3), Export (6), RoundTrip (2), Robustness (5) test files.

---

### Phase 3.3: Media Services — COMPLETE ✅

| Item | Status |
|:-----|:-------|
| Thumbnail generation (Sharp) | ✅ `src/core/Thumbnailer.ts` |
| WebP output, 80% quality | ✅ |
| mtime-based cache invalidation | ✅ |
| Unique cache filenames (MD5 hash) | ✅ |

**Tests**: `tests/core/Thumbnailer.test.ts` (8 passing)

---

### Phase 3.4: API Server & Authentication — COMPLETE ✅

All CRUD, system, and auth endpoints are implemented and tested.

| Endpoint | Status | Tests |
|:---------|:-------|:------|
| `GET /api/system/status` | ✅ | 1 |
| `GET /api/search?q=` | ✅ | 2 |
| `GET /api/people/:id` | ✅ | 2 |
| `POST /api/people` | ✅ | 2 |
| `PUT /api/people/:id` | ✅ | 2 |
| `PUT /api/people/:id/media` | ✅ | 3 |
| `POST /api/import/gedcom` | ✅ | 3 |
| `POST /api/system/rebuild` | ✅ | 1 |
| `POST /api/system/snapshot` | ✅ | 2 |
| `POST /api/auth/login` | ✅ | 4 |
| `POST /api/auth/logout` | ✅ | 1 |
| Auth guard middleware | ✅ | 6 |

**Files**: `src/server.ts`, `src/api/middleware/auth.ts`, `src/schemas/AuthSchema.ts`
**Tests**: `tests/api/Server.test.ts` (21 tests) + `tests/api/Auth.test.ts` (11 tests) + `tests/schemas/AuthSchema.test.ts` (5 tests)

**Authentication Architecture**:
- Auth config stored in `/_meta/auth.yaml` (Zod-validated `AuthConfigSchema`)
- Passwords stored as BCrypt hashes (`bcryptjs`)
- JWT issued in HttpOnly cookie via `@fastify/cookie`
- Fastify `onRequest` hook enforces auth guard on all routes except `POST /api/auth/login` and `GET /api/system/status`
- Auth is **optional**: if `/_meta/auth.yaml` doesn't exist, all routes are public (graceful degradation)

**Known limitations** (resolved in Phase 3.5):
- ~~Write endpoints bypass TransactionManager — no git commits on write operations → 3.5.1~~ **RESOLVED**
- ~~`GET /people/:id` returns empty `_computed` placeholder → 3.5.2~~ **RESOLVED**
- ~~`POST /system/snapshot` doesn't flush pending commits before tagging → 3.5.1~~ **RESOLVED**
- ~~`GET /system/status` returns hardcoded `hydrationState: "ready"` and `cacheAge: null` → 3.5.3~~ **RESOLVED**

---

### Phase 3.5: Backend Optimizations — COMPLETE ✅

All seven performance-hardening items are implemented and tested.

#### 3.5.1 TransactionManager Refactor — COMPLETE ✅ (except isomorphic-git migration)

Refactored TransactionManager from minimal one-commit-per-write to production-grade debounced write layer.

- [x] **Debounced Commit Queue**: `writeFile()` writes to disk immediately, queues for batched git commit. 5-second debounce timer (configurable). Commit message: `"Update N files: Label1, Label2, ..."` (truncated at 72 chars).
- [x] **Flush on Demand**: `flush()` bypasses debounce, commits immediately. `destroy()` flushes + cleans up timers.
- [x] **Track File**: `trackFile()` for files written by other means (binary uploads) that still need git staging.
- [x] **Wire Snapshot Flush**: `POST /system/snapshot` flushes pending commits before creating git tag.
- [x] **isomorphic-git Migration**: **Completed in Phase 3.6.1**. `simple-git` fully replaced with `isomorphic-git`.
- [x] **Wire API Endpoints**: `POST /people`, `PUT /people/:id`, `PUT /people/:id/media`, `POST /import/gedcom` all route through TransactionManager.
- [x] **TDD**: `tests/core/TransactionManager.test.ts` (7 tests) — Batching, flush-on-demand, file labels, truncation, sequential batches, empty flush safety.

#### 3.5.2 Computed Relationship Cache (`_computed`) — COMPLETE ✅

The spec's most architecturally significant remaining item. The API now returns real relationship data.

- [x] **`computeRelationships(nodeId)`**: Implemented in `GraphLogic.ts`. Writes `currentSpouse`, `siblings`, `children`, `allSpouses` to the node's `_computed` attribute.
- [x] **Helper functions**: `getChildren()`, `getAllSpouses()`, `computeAllRelationships()`, `invalidateComputed()`.
- [x] **Hydration Integration**: `computeAllRelationships()` called at end of `GraphEngine.hydrate()`.
- [x] **Invalidation**: `invalidateComputed()` called in hot-patch handler — recomputes changed node AND all immediate neighbors.
- [x] **Wire to API**: `GET /people/:id` reads from `_computed` node attribute (O(1) lookup, no traversal at request time).
- [x] **TDD**: 6 new tests in `tests/core/GraphLogic.test.ts` — children, siblings, currentSpouse, allSpouses, widowed detection, non-person nodes, computeAll.

#### 3.5.3 Tiered Binary Cache — COMPLETE ✅

Accelerate boot time for large datasets (10,000+ nodes). Implements the spec's Binary Cache model (Section 2.3A).

- [x] **`src/core/GraphCache.ts`**: Standalone cache module with `load()`, `save()`, `invalidate()` static methods. Cache format: JSON blob at `/_meta/.graph-cache.json` with `spec_version` header and per-file `mtime` entries.
- [x] **Serialize**: `GraphEngine.hydrate()` writes cache at end of every successful hydration (full or incremental). Stores validated Person data + `mtime` (epoch ms) per source YAML file.
- [x] **Incremental Boot**: On startup, loads cache. If `spec_version` mismatches, cache is missing, or JSON is corrupt → full Nuclear Hydration. Otherwise compares `mtime` per YAML file on disk — re-parses only stale/new files, uses cached data for unchanged files.
- [x] **Cache Write**: Serialized after every successful hydration. New files are added, deleted files are excluded automatically (disk glob drives inclusion).
- [x] **`cacheAge` in Status API**: `GET /system/status` returns ISO-8601 timestamp of last cache write via `GraphEngine.cacheAge` getter.
- [x] **`hydrationState` Tracking**: `GraphEngine.hydrationState` getter exposes `"loading"` during hydration, `"ready"` after. Wired into `GET /system/status`.
- [x] **`forceFullRebuild`**: `hydrate({ forceFullRebuild: true })` bypasses cache entirely. Wired into `POST /system/rebuild`.
- [x] **TDD**: `tests/core/GraphCache.test.ts` (11 tests) — Cache write after hydration, cache hit skips parsing, stale mtime selective re-parse, missing cache → full nuclear, version mismatch → full nuclear, corrupt cache → full nuclear, new files parsed, deleted files excluded, forceFullRebuild bypass, hydrationState tracking, cacheAge exposure.

#### 3.5.4 Diff-Based Edge Reconciliation — COMPLETE ✅

Replace the current "drop all edges and rebuild" hot-patching with precise edge diffing (spec Section 4.1).

- [x] **Edge Diffing**: `reconcileEdges()` compares old vs. new `relationships.parents`. Computes set difference: removes edges for dropped parents, adds edges for new parents. Also handles relationship type changes (e.g., biological → adopted) via attribute update without edge removal.
- [x] **Neighbor Cascade**: After reconciliation, `invalidateComputed()` recomputes `_computed` for the changed node AND all immediate neighbors. `SearchService.indexPerson()` updates the search index.
- [x] **Mini-Hydration Fallback**: `fallbackRebuildEdges()` drops all outgoing `child_of` edges and rebuilds from scratch. Activated via try-catch if diff logic encounters an inconsistent state. Only touches `child_of` edges, preserving other edge types.
- [x] **New Node Handling**: New nodes (no old state) use `addParentEdges()` directly — no diff needed.
- [x] **TDD**: 4 new tests in `tests/core/GraphEngineHotPatch.test.ts` — Add parent adds exactly one edge, remove parent drops exactly one edge, incoming edges from other nodes preserved during reconciliation, relationship type change updates attribute without dropping edge.

#### 3.5.5 Worker Thread Hydration — COMPLETE ✅

Hydration runs in a background `worker_threads` Worker by default. The server starts immediately and remains responsive while data is loading. Applies to all dataset sizes (spec Section 2.3C).

- [x] **Worker Script**: `src/core/HydrationWorker.ts` — Standalone module with `runHydrationWorker()` function + worker entry point (`if (!isMainThread)`). Runs BootLoader, StoryLoader, cache comparison, YAML parsing, and Zod validation inside the worker thread.
- [x] **Cache-Aware**: Worker performs tiered cache comparison internally — reads existing cache, compares mtimes, re-parses only stale/new files. Saves updated cache after loading.
- [x] **Handoff**: Worker serializes validated `PersonEntry[]` + `Story[]` + hydration stats via `postMessage` (structured clone). Main thread calls `buildGraphFromData()` — Graphology graph construction, edge building, search indexing, and `_computed` computation.
- [x] **`hydrateInBackground()`**: New method on `GraphEngine`. Spawns worker, awaits result, builds graph. Falls back to inline `hydrate()` if the worker crashes.
- [x] **503 Loading Gate**: Fastify `onRequest` hook returns 503 `HYDRATION_IN_PROGRESS` for all endpoints except `GET /system/status`, `POST /auth/login`, `POST /auth/logout` while `hydrationState === 'loading'`.
- [x] **`awaitHydration` Config**: `ServerConfig.awaitHydration` (default `true`) controls whether `createServer` blocks until hydration completes. Set `false` for production immediate-availability.
- [x] **ESM Interop**: Worker uses `tsx/cjs` as `execArgv` require hook to handle ESM-only packages (`p-limit`, `remark`) in the CommonJS worker context.
- [x] **TDD**: `tests/core/HydrationWorker.test.ts` (10 tests) — Worker function people loading, cache usage on second run, story loading, forceFullRebuild flag, background hydration graph population, same-output-as-inline, hydrationState tracking, cache persistence, `_computed` population, search index building.

#### 3.5.6 SearchService Improvements — COMPLETE ✅

Full-text search now covers people, stories, and places with incremental hot-patch support.

- [x] **Story Indexing**: `indexStory()` / `removeStory()` methods added. Story nodes wired into `rebuild()` — indexed by `title` and `content`. `search()` returns matching stories with title as display name. FlexSearch Document index with `store: true` for enriched results.
- [x] **Place Search**: `placeMap` (Map<location, Set<personId>>) extracts unique locations from person events. `search()` performs case-insensitive substring match on locations, returns `PlaceResult[]` with `{ location, count }`. Places updated incrementally via `indexPerson()` / `removePerson()`.
- [x] **Hot-Patch Wiring**: `indexPerson()` removes stale search entries before re-adding (prevents ghost matches on name change). `removePerson()` cleans up both search index and place map. Incremental updates already wired via `handleFileUpdate()` → `searchService.indexPerson()`.
- [x] **API Wired**: `GET /api/search` now returns actual `places` array from search results (was hardcoded `[]`). `SearchResponse` type updated to include `PlaceResult[]`.
- [x] **TDD**: 6 new tests in `tests/core/SearchService.test.ts` (10 total) — Story search by title, story search by content, place search, place count with multiple people, name change updates search index, person removal clears search + places.

#### 3.5.7 Timeline Slicer — COMPLETE ✅

Spec Section 4.2. Pre-computes the "Integrated Feed" for the Person Detail page.

- [x] **`src/core/TimelineSlicer.ts`**: `sliceTimeline(graph, personId)` function implemented.
  - Collects all Person Events + Story mentions (stories mentioning this person via graph edges).
  - Sorts merged list by `sort_date`.
  - Gap Detection: If `Item[i+1].year - Item[i].year > 10`, inserts a `Gap` object `{ type: 'gap', years: diff }`.
  - Returns `Array<TimelineEvent | TimelineStory | TimelineGap>`.
- [x] **Wire to API**: `GET /people/:id` includes `timeline` field from `sliceTimeline()` output.
- [x] **TDD**: `tests/core/TimelineSlicer.test.ts` (7 tests) — Event sorting, story merge, gap insertion (>10yr), no gap (≤10yr), multiple gaps, empty person, non-existent person.

---

### Phase 3.6: Production Hardening — COMPLETE ✅

> **Context**: Principal Engineer architecture review identified three backend refinements that must be completed before beginning frontend work. These address scaling fragility (file watchers), write-path overhead (git subprocess spawning), and API payload bloat (missing pagination). All three items completed.

#### 3.6.1 isomorphic-git Migration — COMPLETE ✅

Replaced `simple-git` with `isomorphic-git` for all programmatic git operations. All git operations now run in-process — no child-process spawning. TransactionManager test execution dropped from ~4s to ~128ms.

- [x] **Install `isomorphic-git`**: Added dependency, removed `simple-git` from `dependencies`.
- [x] **Refactor `TransactionManager`**: Replaced all `simple-git` calls with `isomorphic-git` equivalents (`git.add`, `git.commit`). Author info read from git config with fallback to `LegacyGraph` default. All operations run in-process via Node.js `fs`.
- [x] **Refactor Snapshot (`POST /system/snapshot`)**: Replaced `simple-git` tag creation with `isomorphic-git` `git.annotatedTag`. Replaced `checkIsRepo()` with `fs.access(.git)`. Replaced `git.log()` with `isomorphic-git` `git.log`.
- [x] **Refactor Server bootstrap**: Removed `simpleGit` import. Initial commit logic uses `isomorphic-git` `git.add`/`git.commit`.
- [x] **Update tests**: All `TransactionManager.test.ts` (8), `Server.test.ts` (21), and `Auth.test.ts` (11) tests migrated to use `isomorphic-git` for setup/verification. All 40 tests pass.
- [x] **TDD**: Migration verification test added — asserts source code uses `isomorphic-git`, not `simple-git`. Test failed before migration, passes after.

#### 3.6.2 @parcel/watcher Migration — COMPLETE ✅

Replaced `chokidar` with `@parcel/watcher` for file system watching. Uses native OS APIs (FSEvents on macOS, inotify on Linux) via Rust/C++ bindings. EMFILE issue eliminated.

- [x] **Install `@parcel/watcher`**: Added dependency, removed `chokidar` from `dependencies`.
- [x] **Refactor `GraphEngine.startWatcher()`**: Now async. Uses `watcher.subscribe()` with event batching. Maps `create`/`update` → `handleFileUpdate()`, `delete` → `handleFileRemove()`. Filters for `.yaml` files and ignores dotfiles.
- [x] **Subscription Cleanup**: Added `stopWatcher()` method that calls `subscription.unsubscribe()`. Safe to call multiple times (no-op if no active subscription).
- [x] **Un-skip `Watcher.test.ts`**: Fully rewritten with 5 tests — file add detection, file change detection, file deletion detection, cleanup verification, and migration source verification. All passing. No more EMFILE errors.
- [x] **TDD**: Migration verification test and 4 integration tests written before implementation. All initially failed, all pass after migration.

#### 3.6.3 API Pagination — COMPLETE ✅

Added `limit`/`offset` pagination to search and timeline endpoints. Prevents payload bloat for large datasets.

- [x] **`SearchService` Pagination**: `search()` method accepts optional `{ limit, offset }` options. Returns `totalCounts` alongside paginated results. Default `limit=50`, max `200`. Pagination applied per-category (people, stories, places).
- [x] **`TimelineSlicer` Pagination**: `sliceTimeline()` uses TypeScript function overloads — without options returns flat `TimelineItem[]` (backward-compatible), with options returns `PaginatedTimeline { items, totalCount, offset, limit }`. Pagination applied after gap insertion.
- [x] **Wire API Endpoints**: `GET /api/search` accepts `?q=...&limit=50&offset=0`. `GET /api/people/:id` accepts `?timeline_limit=50&timeline_offset=0`. Both parse query params and pass to service layer.
- [x] **Validation**: `limit > 200` → 400 error. Negative `offset` → 400 error. Non-numeric values → 400 error.
- [x] **TDD**: 6 failing tests written before implementation — 3 SearchService (pagination, offset, backward compat) + 3 TimelineSlicer (pagination, offset beyond total, backward compat). All pass after implementation.

---

### Phase 4: Frontend — NOT STARTED ❌

Build the "VS Code for Genealogy" interface. Start with the Command Palette and Person Detail page to expose API design issues early.

> **Technical Constraints (Mandatory)**: See spec Section 6.2. Virtualization, optimistic UI, and hydration-aware shell are non-negotiable.

#### 4.1 Scaffolding & Design System
- [ ] Vite + React + TypeScript + TanStack Router
- [ ] TanStack Query for caching and **optimistic updates** (spec 6.2 constraint)
- [ ] Tailwind CSS with Dark Mode palette (Slate/Zinc/Neutral)
- [ ] Typography: `Inter` (UI), `Fira Code` (Data), `Merriweather` (Stories)
- [ ] Base components: `Button`, `Input`, `Modal` (radix-ui primitives)
- [ ] `Avatar` component (image or initials)
- [ ] **`CmdK` Command Palette** — build early. Debounced (300ms) queries to `/api/search`. Primary navigation tool.
- [ ] **Hydration-aware app shell**: Poll `GET /system/status` or connect to `GET /system/hydration/stream` (SSE). Show progress indicator during loading, block data views until `hydrationState === "ready"`.

#### 4.2 The "Holy Grail" Person Detail Page
- [ ] CSS Grid 3-column layout (Fixed Left, Scrollable Center, Collapsible Right)
- [ ] **Timeline Feed** (center): Consume paginated `TimelineSlicer` output, render `EventCard` and `Gap` components. **Virtualized** via `@tanstack/react-virtual` — only visible items rendered. Infinite-scroll pagination via `timeline_limit`/`timeline_offset`.
- [ ] **Identity Panel** (left): Bio, stats, relationship chips from `_computed`
- [ ] **Context Panel** (right): Assets grid, Markdown Notebook (`scrapbook_md`), Raw YAML tab
- [ ] Inline editing for simple fields (Name, Birth Date) — **optimistic updates** via TanStack Query mutation
- [ ] Embedded Markdown editor for `scrapbook_md`

#### 4.3 Dashboard
- [ ] Stats panel: Total People, Total Families, Last Edited File
- [ ] Force graph visualization (`react-force-graph-2d`)
- [ ] "Gravity Bands" (position nodes by birth year on Y-axis)

#### 4.4 E2E Tests (Playwright)

Spec Section 9.3. Critical user journeys validated end-to-end.

- [ ] Playwright setup with Vite dev server integration
- [ ] **CUJ: Import Flow**: Upload GEDCOM → Wait for hydration (via SSE stream) → Verify node count
- [ ] **CUJ: Holy Grail**: Navigate to Person → Edit Note → Save → Verify persistence (optimistic + server confirm)
- [ ] **CUJ: Time Tunnel** (Phase 5): Load view → Scroll → Verify camera Z position changes

---

### Phase 5: Immersion & Polish — NOT STARTED ❌

#### 5.1 Rich Story Editor
- [ ] Integrate `Tiptap` editor
- [ ] `@Mention` extension (searches Graph for people)
- [ ] `/Asset` extension (inserts image from `/assets`)

#### 5.2 The 3D Time Tunnel
- [ ] `react-three-fiber` setup
- [ ] "Tunnel" geometry mapped to timeline events at Z-depth
- [ ] Scroll-based camera movement

#### 5.3 Observability & Monitoring
- [ ] Expose `heapUsedMB` from `process.memoryUsage()` in `GET /system/status` response
- [ ] Add startup timing metrics (hydration duration, cache hit ratio, node/edge counts) to status endpoint
- [ ] Log memory warnings if heap usage exceeds 75% of V8 limit

---

### Phase 6: Distribution & Deployment — NOT STARTED ❌

- [ ] **Docker**: Multi-stage `Dockerfile` (Build Frontend → Serve Backend)
- [ ] **Electron**: Desktop wrapper for local-file-system access
- [ ] **CI/CD**: GitHub Action running Vitest + Playwright (from Phase 4.4) on PRs

---

## 3. Test Suite

**Total**: 154 tests | **Passing**: 154 | **Skipped**: 0 | **Failing**: 0

| Module | File | Count | Status |
|:-------|:-----|:------|:-------|
| PersonSchema | `tests/schemas/PersonSchema.test.ts` | 3 | ✅ |
| EventSchema | `tests/schemas/EventSchema.test.ts` | 2 | ✅ |
| AssetSchema | `tests/schemas/AssetSchema.test.ts` | 1 | ✅ |
| StorySchema | `tests/schemas/StorySchema.test.ts` | 1 | ✅ |
| AuthSchema | `tests/schemas/AuthSchema.test.ts` | 5 | ✅ |
| SchemaExpansion | `tests/schemas/SchemaExpansion.test.ts` | 6 | ✅ |
| BootLoader | `tests/core/BootLoader.test.ts` | 1 | ✅ |
| GraphEngine | `tests/core/GraphEngine.test.ts` | 1 | ✅ |
| GraphCache | `tests/core/GraphCache.test.ts` | 11 | ✅ |
| GraphLogic | `tests/core/GraphLogic.test.ts` | 8 | ✅ |
| HotPatch | `tests/core/GraphEngineHotPatch.test.ts` | 8 | ✅ |
| HydrationWorker | `tests/core/HydrationWorker.test.ts` | 10 | ✅ |
| SearchService | `tests/core/SearchService.test.ts` | 13 | ✅ |
| StoryLoader | `tests/core/StoryLoader.test.ts` | 1 | ✅ |
| Thumbnailer | `tests/core/Thumbnailer.test.ts` | 8 | ✅ |
| TransactionManager | `tests/core/TransactionManager.test.ts` | 8 | ✅ |
| DateParser | `tests/utils/DateParser.test.ts` | 4 | ✅ |
| GEDCOM Import | `tests/core/gedcom/Import.test.ts` | 3 | ✅ |
| GEDCOM Export | `tests/core/gedcom/Export.test.ts` | 6 | ✅ |
| GEDCOM RoundTrip | `tests/core/gedcom/RoundTrip.test.ts` | 2 | ✅ |
| GEDCOM Robustness | `tests/core/gedcom/Robustness.test.ts` | 5 | ✅ |
| API Server | `tests/api/Server.test.ts` | 21 | ✅ |
| TimelineSlicer | `tests/core/TimelineSlicer.test.ts` | 10 | ✅ |
| Authentication | `tests/api/Auth.test.ts` | 11 | ✅ |
| Watcher | `tests/core/Watcher.test.ts` | 5 | ✅ |

**No skipped tests.** The previously skipped `Watcher.test.ts` (EMFILE with `chokidar`) is now fully passing after the `@parcel/watcher` migration in Phase 3.6.2.

---

## 4. Technical Decisions

Decisions made during implementation that deviate from or elaborate on the spec.

| # | Decision | Rationale |
|:--|:---------|:----------|
| 1 | Use `nanoid()` for media upload filenames | Prevents collisions, URL-safe, preserves file extension |
| 2 | GEDCOM import is destructive (deletes all `*.yaml`) | Clean slate prevents orphaned data; `.git` history preserved |
| 3 | ~~Snapshot uses `simple-git` (not `isomorphic-git` yet)~~ | ~~Already a dependency. Migration deferred to 3.5.1~~ → Superseded by Decision #14 (Phase 3.6.1) |
| 4 | Snapshot auto-creates initial commit if HEAD missing | Handles fresh repos gracefully without requiring manual setup |
| 5 | API Server tests init a git repo in `tests/fixtures/data/` | Required for snapshot endpoint testing; created in `beforeEach` |
| 6 | Auth is optional (graceful degradation) | If `/_meta/auth.yaml` missing, all routes remain public. Allows dev/testing without auth setup |
| 7 | `bcryptjs` over `bcrypt` for password hashing | Pure JS — no native compilation required, easier cross-platform deployment |
| 8 | Auth tests use isolated `tests/fixtures/auth-data/` directory | Prevents race conditions with parallel `Server.test.ts` which shares `tests/fixtures/data/` |
| 9 | GraphEngine re-created per `createServer()` call | Fixes singleton leakage across parallel test files; `onClose` hook nulls the reference |
| 10 | Cache uses absolute file paths as keys | Simplifies mtime comparison (glob returns absolute paths). Cache auto-invalidates if data directory moves — triggers full nuclear, which is correct behavior |
| 11 | `cacheAge` is an ISO-8601 timestamp (not duration string) | Unambiguous, machine-parseable. Frontend can compute "X minutes ago" from the timestamp |
| 12 | Worker thread uses `tsx/cjs` for ESM interop | `p-limit` v7 and `remark` v15 are ESM-only; the project uses CommonJS. `tsx` resolves `require()` of ESM modules in the worker thread. Added as devDependency |
| 13 | `awaitHydration` defaults to `true` in `ServerConfig` | Preserves backward compatibility for tests (which expect hydration complete before assertions). Set `false` for production immediate-availability |
| 14 | `isomorphic-git` migration elevated to immediate (Phase 3.6.1) | Principal Engineer review: child-process overhead from `simple-git` is an architectural flaw, not an optimization deferral. Must resolve before frontend consumes write APIs |
| 15 | Replace `chokidar` with `@parcel/watcher` (Phase 3.6.2) | Native OS watcher APIs via Rust/C++ bindings eliminate EMFILE limits. Resolves skipped `Watcher.test.ts` |
| 16 | API pagination mandatory before frontend (Phase 3.6.3) | Unbounded search/timeline responses would lock up the browser DOM for large datasets. `limit`/`offset` with `totalCounts` prevents payload bloat |
| 17 | Virtualization mandatory in frontend (Phase 4) | Timeline Feed and Search Results must use `@tanstack/react-virtual` or equivalent. No DOM nodes for off-screen items |
| 18 | SSE hydration stream (`GET /system/hydration/stream`) | Replaces polling `GET /system/status` with a push-based progress stream. Frontend connects on boot, shows real progress bar |

