# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. For the _what_ and _why_, see `SPECIFICATION.md`.
> For the _how far_ and _what's next_, read this document.

**Last Updated**: 2026-02-22
**Test Suite**: 199 passing, 0 skipped (199 total)
**Overall Completion**: ~72% of full spec (backend complete, frontend next)

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
| **3.7** | Data Layer Hardening (3 items) | ✅ Complete |
| **3.8** | Pre-Frontend Hardening (5 items) | ✅ Complete (all 5 items) |
| **3.9** | More Backend Hardening (3 items) | ✅ Complete (all 3 items) |
| **3.10** | Final Data Layer Hardening (2 items) | ✅ Complete |
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

> **Context**: Architecture review identified three backend refinements that must be completed before beginning frontend work. These address scaling fragility (file watchers), write-path overhead (git subprocess spawning), and API payload bloat (missing pagination). All three items completed.

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

### Phase 3.7: Data Layer Hardening — NOT STARTED ❌

> **Context**: Architecture review identified three structural limits that will degrade performance at 50,000+ nodes. These must be resolved before the frontend consumes the API, ensuring the data layer is rock-solid under load.

#### 3.7.1 Slim Node Strategy (Memory Budgeting) — COMPLETE ✅

Strip `scrapbook_md` and `_gedcom` from the in-memory Graphology runtime. At 50K nodes with 2KB of markdown each, these fields consume ~100MB of V8 heap doing nothing until a detail page is opened. See spec Section 2.3B.

- [x] **Define `SlimPerson` type**: `Omit<Person, 'scrapbook_md' | '_gedcom'>` in `PersonSchema.ts`. Utility `toSlimPerson()` strips heavy fields via destructuring.
- [x] **Strip during hydration**: `buildGraphFromData()` calls `toSlimPerson()` before `graph.addNode()`. Inline search indexing with bio extracted before stripping (replaces `rebuild()` call).
- [x] **Strip during hot-patch**: `handleFileUpdate()` calls `toSlimPerson()` before `graph.mergeNodeAttributes()`. Bio passed to `indexPerson()` from full Person data.
- [x] **Reverse file map**: `reverseFileMap: Map<PersonID, FilePath>` maintained alongside `fileMap` for O(1) lazy-load lookups. `getFilePathForPerson()` public accessor.
- [x] **Lazy load in API**: `loadHeavyFields(personId)` reads source YAML from disk, extracts `scrapbook_md` and `_gedcom`. `GET /api/people/:id` merges lazy-loaded fields into response. `PUT /people/:id/media` reconstructs full Person from slim + disk for YAML write.
- [x] **Search indexing**: `SearchService.indexPerson()` accepts optional `bio` parameter. Falls back to `p.scrapbook_md` for backward compat with full Person objects (tests). Slim callers pass bio explicitly.
- [x] **Server write handlers**: `POST /people`, `PUT /people/:id`, `PUT /people/:id/media` all store `toSlimPerson()` in graph.
- [x] **TDD**: `tests/core/SlimNode.test.ts` (10 tests) — toSlimPerson utility, scrapbook_md absent after hydration, _gedcom absent after hydration, slim after hot-patch, file path lookup, unknown ID returns undefined, lazy-load round-trip, null for unknown ID, bio search after hydration, bio search after hot-patch.
- [x] **Deferred**: Cache stripping (`GraphCache`) and worker handoff stripping (`HydrationWorker`) deferred to **Phase 3.10.1**.

#### 3.7.2 Search Index Persistence — COMPLETE ✅

FlexSearch indices are fully rebuilt on every boot. For 50K+ nodes, tokenizing and indexing is heavy CPU work even with the worker thread. FlexSearch supports export/import of compiled indices. See spec Section 2.3D.

- [x] **`SearchService.exportIndex(filePath)`**: Serializes FlexSearch person/story indexes, place map, and tracked person/story IDs to `/_meta/.search-index.json`. Uses FlexSearch's native `export()` API. Includes `spec_version` header for cache invalidation.
- [x] **`SearchService.importIndex(filePath)`**: Loads and validates cached index from disk. Returns `null` on missing file, corrupt JSON, or `spec_version` mismatch (triggers full rebuild). Restores FlexSearch indexes, place map, and tracked IDs.
- [x] **Incremental boot integration**: `buildGraphFromData()` attempts `importIndex()` first. If successful, only entries with `wasParsed === true` (mtime changed) are re-indexed. Cached entries are skipped. Deleted people (in old index but not in current data) are removed from the imported index.
- [x] **`wasParsed` flag on `PersonEntry`**: Added optional `wasParsed: boolean` to `PersonEntry` interface. Set `true` for YAML-parsed entries, `false` for cache-hit entries. Propagated through both inline hydration and worker thread paths.
- [x] **Wire to hydration**: `exportIndex()` called after both `hydrate()` and `hydrateInBackground()` complete. Both inline and worker paths persist the search index.
- [x] **Wire to `POST /system/rebuild`**: `forceFullRebuild` path ignores both graph cache and search index cache — full nuclear rebuild.
- [x] **ID tracking**: `trackPerson()` / `untrackPerson()` / `trackStory()` maintain lists of indexed IDs for deletion detection on incremental boots.
- [x] **TDD**: `tests/core/SearchPersistence.test.ts` (8 tests) — Index file written after hydration, identical search results from cache, incremental re-index of changed nodes, deleted people removed from search, missing index → full rebuild, corrupt index → full rebuild, version mismatch → full rebuild, forceFullRebuild writes fresh index.
- [x] **Deferred**: Debounced hot-patch persistence (re-exporting index during live edits) deferred to **Phase 3.10.2**.

#### 3.7.3 Write-Event Deduplication — COMPLETE ✅

When the API writes a YAML file, the file watcher detects the change and triggers a redundant hot-patch for an update the engine already applied. See spec Section 4.1.

- [x] **Self-write map on `GraphEngine`**: `Map<string, number>` maps absolute file paths to expiry timestamps. `registerSelfWrite(path, ttlMs?)`, `hasSelfWrite(path)`, `consumeSelfWrite(path)` — consume is single-use (removes entry on first check).
- [x] **Watcher deduplication**: Both `handleFileUpdate()` and `handleFileRemove()` call `consumeSelfWrite()` first. If the path is present and not expired, the hot-patch is skipped entirely.
- [x] **Wire `TransactionManager`**: New `onFileWritten` callback in `TransactionManagerOptions`. Called after `fs.writeFile()` completes in `writeFile()`. Registered in `server.ts` to call `graphEngine.registerSelfWrite()`.
- [x] **Wire API handlers**: All writes go through `TransactionManager.writeFile()` → `onFileWritten` → `registerSelfWrite`. Covers `POST /people`, `PUT /people/:id`, `PUT /people/:id/media`, and `POST /import/gedcom`.
- [x] **TTL cleanup**: Default TTL is 10 seconds. Configurable per call (useful for tests). Expired entries are lazily cleaned up on `hasSelfWrite()` and `consumeSelfWrite()` checks.
- [x] **TDD**: `tests/core/WriteDedup.test.ts` (7 tests) — Register self-write, consume removes entry (single-use), unregistered returns false, skip hot-patch for self-written files, process external edits normally, skip handleFileRemove for self-written deletions, TTL expiration.

---

### Phase 3.8: Pre-Frontend Hardening — COMPLETE ✅

> **Context**: Architecture review identified five structural fixes that must be completed before beginning frontend work. These address API write-path consistency, server decomposition, hydration observability, search performance, and story hot-patching.

#### 3.8.1 API Write Path Gap Fix — COMPLETE ✅

API write handlers (`POST /people`, `PUT /people/:id`, `PUT /people/:id/media`) were adding/updating graph nodes but skipping edge reconciliation, `_computed` invalidation, and search indexing. Combined with self-write dedup (which suppresses the watcher), persons created/updated via the API were invisible to search and had no computed relationships until restart.

- [x] **`applyWriteSideEffects()` on `GraphEngine`**: Public method encapsulating edge reconciliation, search indexing, and `_computed` invalidation. Called by both API handlers and `handleFileUpdate()` to eliminate duplication.
- [x] **Wire `POST /people`**: After `graph.addNode()`, calls `applyWriteSideEffects(id, null, slim, bio)` — adds parent edges, indexes in search, computes relationships.
- [x] **Wire `PUT /people/:id`**: Captures old slim data before update for edge reconciliation, calls `applyWriteSideEffects(id, oldSlim, newSlim, bio)`.
- [x] **Wire `PUT /people/:id/media`**: Calls `invalidateComputed()` after updating assets.
- [x] **Start watcher**: `startWatcher()` called after hydration completes in `createServer()`.
- [x] **Stop watcher**: `stopWatcher()` called in the `onClose` hook.
- [x] **Fix `require('fs')`**: Replaced inline `require('fs').createWriteStream` with `nodeFs.createWriteStream` (already imported).
- [x] **TDD**: 4 new tests in `tests/api/Server.test.ts` — POST indexes person in search, POST with parents wires edges, PUT updates search index, PUT recomputes `_computed` for neighbors.

#### 3.8.2 Decompose server.ts Into Route Plugins — COMPLETE ✅

Refactored the 650-line monolithic `server.ts` into Fastify route plugins. Eliminated module-level singleton state.

- [x] **`src/api/types.ts`**: Shared `AppServices` interface and `AppInstance` type for decorated Fastify instance.
- [x] **`src/api/routes/system.ts`**: System status, rebuild, snapshot endpoints.
- [x] **`src/api/routes/auth.ts`**: Login, logout endpoints.
- [x] **`src/api/routes/search.ts`**: Search endpoint with pagination.
- [x] **`src/api/routes/people.ts`**: CRUD + media upload endpoints with full write-path side effects.
- [x] **`src/api/routes/gedcom.ts`**: GEDCOM import endpoint.
- [x] **`server.decorate('appServices', ...)`**: State bound to Fastify instance lifecycle, not module globals.
- [x] **`server.ts` reduced to ~95 lines**: Plugin registration, Fastify decorations, hooks, no route handlers.
- [x] **All 36 API tests pass**: 25 `Server.test.ts` + 11 `Auth.test.ts` — zero behavior change.

#### 3.8.3 SSE Hydration Stream — COMPLETE ✅

Implemented `GET /system/hydration/stream` (spec Section 5.3). Server-Sent Events stream of hydration progress.

- [x] **Worker progress events**: `HydrationWorker.ts` emits `{ type: 'progress', phase, loaded, total, percent }` via `parentPort.postMessage()` during file processing (every 50 files). Both full and incremental paths emit progress.
- [x] **`GraphEngine` extends `EventEmitter`**: Relays worker progress as `hydration:progress` events, emits `hydration:complete` with `{ nodeCount, edgeCount, elapsedMs }` at end of both inline and background hydration.
- [x] **SSE endpoint**: `GET /api/system/hydration/stream` in `src/api/routes/system.ts`. Returns `Content-Type: text/event-stream`. If already hydrated, sends `event: complete` immediately and closes. During loading, streams `event: progress` events then `event: complete`.
- [x] **503 exempt**: Added to loading gate exempt list.
- [x] **Auth exempt**: Added to `PUBLIC_ROUTES` in `src/api/middleware/auth.ts`.
- [x] **TDD**: `tests/api/HydrationStream.test.ts` (4 tests) — content-type, complete event when ready, 503 exempt, auth exempt.

#### 3.8.4 Search Performance Fix — COMPLETE ✅

Converted `trackedPersonIds` and `trackedStoryIds` from `Array<string>` to `Set<string>`, eliminating O(n^2) tracking during hydration. Documented FlexSearch pagination scaling tradeoffs.

- [x] **`trackedPersonIds` → `Set<string>`**: `trackPerson()`, `untrackPerson()` now O(1). Was O(n) per call via `Array.includes()`, making hydration O(n^2).
- [x] **`trackedStoryIds` → `Set<string>`**: Same fix for story tracking.
- [x] **`exportIndex()`**: Serializes Sets to arrays via `Array.from()` for JSON compatibility.
- [x] **`importIndex()`**: Restores tracked IDs as `new Set()` from deserialized arrays.
- [x] **Search scaling documented**: Comments in `search()` explain that FlexSearch's per-field `limit` produces inaccurate `totalCounts` after cross-field deduplication. Collect-and-slice is correct for exact counts. Two-pass strategy (un-enriched count + enriched page) documented as future optimization for 50K+ datasets.
- [x] **Place search scaling documented**: O(n) where n = unique locations (bounded by location count, not people). FlexSearch indexing for places noted as future optimization.
- [x] **TDD**: 3 new tests in `tests/core/SearchService.test.ts` — `trackedPersonIds` is Set, `trackedStoryIds` is Set, FlexSearch limit bounds engine output.

#### 3.8.5 Story Watching — COMPLETE ✅

Extended the file watcher to monitor `stories/` alongside `people/`. Story changes (create, edit, delete) now hot-patch the graph, search index, and timeline in real-time.

- [x] **`startWatcher()` dual subscription**: Watches both `people/` (YAML) and `stories/` (Markdown) via separate `@parcel/watcher` subscriptions. Story watcher gracefully handles missing `stories/` directory.
- [x] **`stopWatcher()` cleanup**: Unsubscribes both watcher subscriptions.
- [x] **`parseSingleStory()`**: Private method on `GraphEngine` to parse a single markdown file — extracts frontmatter via `gray-matter`, validates with `StorySchema`, extracts `@N_xxx` and `[[N_xxx]]` mentions via remark AST walk.
- [x] **`handleStoryUpdate()`**: Parses story, adds/updates graph node (type: 'story'), reconciles mentions edges (drop old, add new), indexes in search via `indexStory()`, invalidates `_computed` for mentioned persons (timeline changes).
- [x] **`handleStoryRemove()`**: Drops story node + edges from graph, removes from search via `removeStory()`, invalidates `_computed` for previously-mentioned persons.
- [x] **Self-write dedup**: Story handlers check `consumeSelfWrite()` to skip watcher-triggered events for API-initiated writes (future-proofed for Phase 5.1 story editor).
- [x] **TDD**: 4 new tests in `tests/core/Watcher.test.ts` — story add creates node + edges, story update refreshes title, story remove drops node + edges, story indexed in search.

---

### Phase 3.9: More Backend Hardening — COMPLETE ✅

#### 3.9.1 File Watcher Circuit Breaker — COMPLETE ✅
- [x] Implement sliding window in `startWatcher()`.
- [x] Trigger background re-hydration if >50 events/500ms limits are hit.
- [x] Add tests for burst resistance.

#### 3.9.2 Graceful Shutdown Flush — COMPLETE ✅
- [x] Handle `process.on('SIGINT')` and `process.on('SIGTERM')` in application bootstrapper.
- [x] Wait for `server.close()` and `TransactionManager.destroy()`.

#### 3.9.3 Static Asset Delivery Performance — COMPLETE ✅
- [x] Add `@fastify/static` dependency.
- [x] Expose `GET /assets/*` with HTTP Range requests support.
- [x] Apply `maxAge: 31536000` and `immutable: true` Cache-Control policies.

---

### Phase 3.10: Final Data Layer Hardening — COMPLETE ✅

> **Context**: Two critical scaling optimizations deferred during Phase 3.7, now resolved.

#### 3.10.1 Cache & Worker Handoff Stripping — COMPLETE ✅

- [x] **HydrationWorker stripping**: `toSlimPerson()` called before `postMessage` in both full and incremental paths. Bio extracted explicitly from `data.scrapbook_md` before stripping.
- [x] **GraphCache uses SlimPerson**: `CacheEntry.data` typed as `SlimPerson`. Cache only serializes slim data + bio.
- [x] **Search indexing**: `buildGraphFromData()` uses `entry.bio` (passed explicitly from worker/cache) without lazy-loading.

#### 3.10.2 Search Index Hot-Patch Persistence — COMPLETE ✅

- [x] **Debounced persistence**: `SearchService.debouncePersist()` calls `exportIndex()` with 500ms debounce after `indexPerson()`, `removePerson()`, `indexStory()`, `removeStory()` mutations.
- [x] **Persistence path**: `setPersistencePath()` configured during hydration in `GraphEngine`.
- [x] **TDD**: `tests/core/SearchPersistence.test.ts` verifies index written after hot-patch mutations.

---

### Phase 4: Frontend — NOT STARTED ❌

Build the "VS Code for Genealogy" interface. See spec Section 6 for full UI specification.

> **Technical Constraints (Mandatory)**: See spec Section 6.9. Virtualization, optimistic UI, hydration-aware shell, typed API client, and responsive design are non-negotiable.
>
> **Execution Order Rationale**: TanStack Query must be wired immediately — its optimistic updates are mandatory to mask the slight latency of the debounced Git queue. The app shell must consume the SSE hydration stream before any data views are built. CmdK is built early because it drives all navigation and forces real search latency testing. E2E tests lock in the critical user journey as soon as the detail page can mutate and persist.
>
> **Architecture Decisions**: React + Vite + TypeScript in a `client/` directory. shadcn/ui (Radix + Tailwind v4) for components. Zustand for UI state. TanStack Router + TanStack Query for routing and data. Lucide React for icons. See spec Section 6.1.

#### 4.0 Backend API Additions (Frontend Prerequisites) — COMPLETE ✅

The frontend requires two small backend additions before data views can be built (spec Section 6.10):

- [x] `GET /api/people` — paginated list of all people (slim summaries). Query: `?limit=50&offset=0&sort=last_modified&order=desc`. Returns `{ people: SlimPersonSummary[], totalCount: number }`.
- [x] `GET /api/stats` — dashboard stats (total people, total families, last modified). Could extend `GET /system/status`.
- [x] TDD: Tests for both new endpoints in `tests/api/Server.test.ts`.

#### 4.1 UI Foundation & Scaffolding

Bootstrap the `client/` directory with all tooling.

- [ ] `npx create-vite client --template react-ts` + TanStack Router + TanStack Query
- [ ] Tailwind CSS v4 setup with dark mode palette (Slate/Zinc/Neutral)
- [x] shadcn/ui initialization (`npx shadcn@latest init`)
- [x] Typography: Google Fonts — `Inter` (UI), `Fira Code` (data), `Merriweather` (stories)
- [x] Zustand store skeleton (`useUIStore`): sidebar state, active panel, modals
- [x] Typed API client layer: `client/src/api/` with fetch wrappers for all backend endpoints
- [x] TanStack Query hooks: `usePerson`, `usePeople`, `useSearch`, `useSystemStatus`, `useUpdatePerson` (with optimistic update boilerplate)
- [x] Base shadcn/ui components imported: `Button`, `Input`, `Dialog`, `Command`, `Badge`, `Tabs`, `HoverCard`, `Resizable`, `Skeleton`, `Sonner`
- [x] Custom `Avatar` component (photo from assets or generated initials)
- [x] Vite dev proxy to backend (`/api` → `http://localhost:3000/api`)

#### 4.2 App Shell & Hydration Awareness — COMPLETE ✅

The structural frame — must work before any data views are built.

- [x] **Persistent Left Sidebar**: VS Code activity bar pattern — Dashboard, People, Import, Settings. Icons + labels. Collapsible to icon-only.
- [x] **Top Bar**: Breadcrumbs, Cmd+K search trigger, auth status.
- [x] **Responsive behavior**: Full sidebar ≥1280px, icon-only 768–1279px, hamburger menu <768px.
- [x] **Status indicator**: `StatusDot` in sidebar footer — green/amber/red based on `GET /system/status`.
- [x] **`HydrationProgress` overlay**: Full-screen on boot. Connects to `GET /system/hydration/stream` SSE. Shows progress bar (phase, percent, node count). Fades out on `hydrationState === "ready"`. Handles 503 gracefully.
- [x] **Error boundaries**: Global + per-route. Graceful API failure handling.
- [x] **Route structure**: `/` (Dashboard), `/people` (Browse), `/people/:id` (Detail), `/import`, `/settings`, `/search?q=`.

#### 4.3 Command Palette (CmdK) — COMPLETE ✅

Build early — primary navigation tool. Forces real testing of paginated search.

- [x] shadcn/ui `Command` component (wraps `cmdk`)
- [x] Global hotkey: `Cmd+K` / `Ctrl+K` + search button in Top Bar
- [x] Debounced input (300ms) queries `GET /api/search?q=...&limit=20`
- [x] Categorized results: **People** (with Avatar), **Stories**, **Places**
- [x] Keyboard navigation: ↑/↓ arrows, Enter to select, Escape to close
- [x] On select: navigate to `/people/:id`, story detail, or place filter
- [x] Footer: "View all results →" links to `/search?q=...` full page

#### 4.4 People Browse Page — COMPLETE ✅

Searchable, sortable table of all people. Simpler than the Holy Grail — good warm-up.

- [x] Dense table: Avatar, Name, Birth Date, Death Date, Tags, # Events
- [x] Sortable columns via API query params
- [x] Inline search filter bar
- [x] Click row → navigate to `/people/:id`
- [x] Virtual scrolling via `@tanstack/react-virtual`
- [x] Paginated via `GET /api/people?limit=50&offset=0`

#### 4.5 The "Holy Grail" Person Detail Page — PARTIAL 🔧

The most critical view. 3-column resizable layout (spec Section 6.5).

- [x] **Panel framework**: Integrate `react-resizable-panels` for the 3-column layout (22%/50%/28% default). Responsive: stacked below 768px.
  - *Bug Fix*: Resolved issue where panels collapsed to 15-40px and handles were unresponsive by using percentage strings (e.g., `"50%"`) instead of numeric values (which default to `px` in v4.6.5) for `defaultSize`/`minSize`/`maxSize`, and changing the `<main>` container to `overflow-hidden`.
- [x] **Identity Panel** (left) — basic:
  - Avatar (photo or initials)
  - Display name, sex badge
  - Vital dates derived from `events[]` (birth/death), read-only
  - Relationship sections (Parents, Spouses, Children, Siblings) — renders ID links from `_computed` (not `PersonChip`/`HoverCard`)
  - Tags displayed as badges, read-only
- [ ] **Identity Panel** — pending:
  - Click-to-edit name (inline, optimistic `PUT /people/:id`)
  - Click-to-edit vital dates
  - `PersonChip` with `HoverCard` previews on relationship links
  - Inline editable tags
- [x] **Timeline Feed** (center) — basic:
  - Events rendered via simple `.map` from `person.timeline`
  - "+ Add Event" button (non-functional placeholder)
- [ ] **Timeline Feed** — pending:
  - Virtualization via `@tanstack/react-virtual`
  - `useInfiniteQuery` for paginated scroll (`timeline_limit`/`timeline_offset`)
  - `EventCard`, `StoryCard`, `GapIndicator` components
  - Click event → opens Event Editor pre-filled
- [x] **Context Panel** (right):
  - Tabbed: Assets | Notebook | GEDCOM
  - Assets: thumbnail grid from `/assets/`
  - Notebook: renders `scrapbook_md` as read-only text
  - GEDCOM: shows `_gedcom` as JSON
- [ ] **Context Panel** — pending:
  - Drag-drop asset upload
  - Notebook textarea editor (Tiptap in Phase 5.1)

#### 4.6 Event & Relationship Editors — COMPLETE ✅

Full modal-based editors for data entry (spec Sections 6.5.5, 6.5.6).

- [x] **Event Editor** modal (`Dialog`):
  - Event type dropdown (all 11 types)
  - Dynamic fields based on type (partner_id for marriage, cause for death, etc.)
  - Common fields: date, sort_date (date picker), location (place autocomplete), description, assets
  - Partner/person selector: type-ahead search with `PersonChip` results
  - Client-side Zod validation (mirrors backend `EventSchema`)
  - Save via `PUT /people/:id` with optimistic update
- [x] **Relationship Editor**:
  - Add parent: searchable person selector + relationship type
  - Remove parent: confirm dialog
  - Save via `PUT /people/:id` (backend handles edge reconciliation)
- [x] **Create Person** modal (for creating new people from anywhere — e.g., during partner selection)

#### 4.7 Import & Settings Pages — COMPLETE ✅

Supporting pages (spec Section 6.8).

- [x] **Import Page**: Drag-and-drop GEDCOM upload, destructive action warning, SSE progress bar, redirect to Dashboard on completion
- [x] **Settings Page**: Live system status, Force Rebuild button (with SSE progress), Create Snapshot, auth management

#### 4.8 E2E Tests (Playwright)

Spec Section 9.3. Build as soon as the Holy Grail page can mutate and save.

- [ ] Playwright setup with Vite dev server integration
- [ ] **CUJ: Import → View → Edit → Persist**: Upload GEDCOM → Wait for hydration (SSE) → Verify node count → Navigate to Person → Edit field → Save → Verify persistence → Reload → Verify round-trip
- [ ] **CUJ: Search Navigation**: Open CmdK → Type query → Select result → Verify navigation → Verify correct person
- [ ] **CUJ: Responsive Layout**: Resize viewport → Verify sidebar collapse → Verify panel stacking on mobile

#### 4.9 Dashboard — COMPLETE ✅

Landing page overview (spec Section 6.7).

- [x] Stats cards: Total People, Total Families, Last Edited, System Status
- [ ] Force graph visualization (`react-force-graph-2d`): nodes = people, edges = relationships. Click node → navigate to person.
- [ ] "Gravity Bands" (Phase 5): position by birth year.

#### 4.10 Search Results Page — COMPLETE ✅

Full-page search results linked from CmdK "View all" action.

- [x] Route: `/search?q=...`
- [x] Categorized sections: People, Stories, Places
- [x] Paginated via `GET /api/search?q=...&limit=50&offset=0`
- [x] Virtualized results list

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

**Total**: 199 tests | **Passing**: 199 | **Skipped**: 0 | **Failing**: 0

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
| SearchService | `tests/core/SearchService.test.ts` | 16 | ✅ |
| StoryLoader | `tests/core/StoryLoader.test.ts` | 1 | ✅ |
| Thumbnailer | `tests/core/Thumbnailer.test.ts` | 8 | ✅ |
| TransactionManager | `tests/core/TransactionManager.test.ts` | 8 | ✅ |
| DateParser | `tests/utils/DateParser.test.ts` | 4 | ✅ |
| GEDCOM Import | `tests/core/gedcom/Import.test.ts` | 3 | ✅ |
| GEDCOM Export | `tests/core/gedcom/Export.test.ts` | 6 | ✅ |
| GEDCOM RoundTrip | `tests/core/gedcom/RoundTrip.test.ts` | 2 | ✅ |
| GEDCOM Robustness | `tests/core/gedcom/Robustness.test.ts` | 5 | ✅ |
| API Server | `tests/api/Server.test.ts` | 25 | ✅ |
| TimelineSlicer | `tests/core/TimelineSlicer.test.ts` | 10 | ✅ |
| Authentication | `tests/api/Auth.test.ts` | 11 | ✅ |
| SlimNode | `tests/core/SlimNode.test.ts` | 10 | ✅ |
| SearchPersistence | `tests/core/SearchPersistence.test.ts` | 8 | ✅ |
| WriteDedup | `tests/core/WriteDedup.test.ts` | 7 | ✅ |
| Watcher | `tests/core/Watcher.test.ts` | 10 | ✅ |
| HydrationStream | `tests/api/HydrationStream.test.ts` | 4 | ✅ |
| MediaDelivery | `tests/api/MediaDelivery.test.ts` | 3 | ✅ |

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
| 14 | `isomorphic-git` migration elevated to immediate (Phase 3.6.1) | Architecture review: child-process overhead from `simple-git` is an architectural flaw, not an optimization deferral. Must resolve before frontend consumes write APIs |
| 15 | Replace `chokidar` with `@parcel/watcher` (Phase 3.6.2) | Native OS watcher APIs via Rust/C++ bindings eliminate EMFILE limits. Resolves skipped `Watcher.test.ts` |
| 16 | API pagination mandatory before frontend (Phase 3.6.3) | Unbounded search/timeline responses would lock up the browser DOM for large datasets. `limit`/`offset` with `totalCounts` prevents payload bloat |
| 17 | Virtualization mandatory in frontend (Phase 4) | Timeline Feed and Search Results must use `@tanstack/react-virtual` or equivalent. No DOM nodes for off-screen items |
| 18 | SSE hydration stream (`GET /system/hydration/stream`) | Replaces polling `GET /system/status` with a push-based progress stream. Frontend connects on boot, shows real progress bar |
| 19 | Slim Node Strategy — strip `scrapbook_md` + `_gedcom` from in-memory graph (Phase 3.7.1) | Architecture review: 50K nodes × 2KB markdown = ~100MB idle in V8 heap. Lazy-load heavy fields from disk on `GET /people/:id` only |
| 20 | Search Index Persistence — serialize FlexSearch to disk (Phase 3.7.2) | PE scaling review: rebuilding FlexSearch index for 50K+ nodes on every boot is avoidable CPU work. Export/import compiled index, surgically update changed nodes |
| 21 | Write-Event Deduplication — self-write ignore set (Phase 3.7.3) | PE scaling review: API writes trigger redundant watcher hot-patches. Write-origin set with TTL prevents double-processing |
| 22 | Phase 4 execution order: Foundation → Shell → CmdK → Browse → Holy Grail → Editors → Import/Settings → E2E → Dashboard → Search | PE recommendation: TanStack Query + optimistic updates from day one; CmdK early to battle-test search; Browse before Holy Grail as warm-up; E2E locked as soon as edit→persist works |
| 23 | Frontend architecture: `client/` directory, shadcn/ui, Zustand, Tailwind v4 | User decision: prioritize stability, testability, and elegance. shadcn/ui for accessible styled components without bundle bloat. Zustand for minimal, testable UI state |
| 24 | Responsive design mandatory | User decision: persistent sidebar collapses to icon-only on tablet, hamburger on mobile. Holy Grail panels stack on small screens |
| 25 | Full event/relationship editors from Phase 4 | User decision: not just inline text editing — modal-based event editor for all 11 types with dynamic fields, searchable person selectors |
| 26 | Hover preview cards (`HoverCard`) on person references | User decision: `PersonChip` components show avatar + vital dates on hover, click to navigate |

