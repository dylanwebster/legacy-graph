# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. For the _what_ and _why_, see `spec.md`.
> For the _how far_ and _what's next_, read this document.

**Last Updated**: 2026-02-16
**Test Suite**: 111 passing, 1 skipped (112 total)
**Overall Completion**: ~52% of full spec

---

## 1. Phase Summary

| Phase | Description | Status |
|:------|:------------|:-------|
| **1 & 2** | Core Logic (Schemas, Graph, BootLoader) | ✅ Complete |
| **3.1** | Search Infrastructure | ✅ Complete (story/place indexing pending → 3.5.6) |
| **3.2** | GEDCOM Interchange | ✅ Complete |
| **3.3** | Media Services | ✅ Complete |
| **3.4** | API Server & Auth | ✅ Complete |
| **3.5** | Backend Optimizations (7 items) | ⚠️ 3.5.1 + 3.5.2 + 3.5.7 complete |
| **4** | Frontend (React UI) + E2E Tests | ❌ Not started |
| **5** | Immersion & Polish | ❌ Not started |
| **6** | Distribution & Deployment | ❌ Not started |

---

## 2. Detailed Implementation Status

### Phase 1 & 2: Core Logic — COMPLETE ✅

All foundational modules are implemented and tested.

| Module | File | Tests | Notes |
|:-------|:-----|:------|:------|
| BootLoader | `src/core/BootLoader.ts` | `tests/core/BootLoader.test.ts` ✅ (1) | YAML parsing via Zod, `p-limit` concurrency, asset integrity checks |
| GraphEngine | `src/core/GraphEngine.ts` | `tests/core/GraphEngine.test.ts` ✅ (1) | Graphology directed multigraph, `hydrate()`, `startWatcher()` via Chokidar |
| GraphLogic | `src/core/GraphLogic.ts` | `tests/core/GraphLogic.test.ts` ✅ (2) | Henry VIII spouse algorithm, `getSiblings`, `getAggregatedAssets` |
| PersonSchema | `src/schemas/PersonSchema.ts` | `tests/schemas/PersonSchema.test.ts` ✅ (3) | All v5.0 fields including `scrapbook_md`, `_gedcom` |
| EventSchema | `src/schemas/EventSchema.ts` | `tests/schemas/EventSchema.test.ts` ✅ (2) | Discriminated union, all 11 event types |
| StorySchema | `src/schemas/StorySchema.ts` | `tests/schemas/StorySchema.test.ts` ✅ (1) | Markdown frontmatter schema |
| AssetSchema | `src/schemas/AssetSchema.ts` | `tests/schemas/AssetSchema.test.ts` ✅ (1) | Asset metadata schema |
| SchemaExpansion | (cross-schema) | `tests/schemas/SchemaExpansion.test.ts` ✅ (6) | Validates `scrapbook_md`, `_gedcom`, all event type variants |
| StoryLoader | `src/core/StoryLoader.ts` | `tests/core/StoryLoader.test.ts` ✅ (1) | Markdown + `@mention`/`[[wikilink]]` extraction |
| TransactionManager | `src/core/TransactionManager.ts` | `tests/core/TransactionManager.test.ts` ✅ (1) | Mutex + simple-git (minimal, no batching) |
| DateParser | `src/utils/dateParser.ts` | `tests/utils/DateParser.test.ts` ✅ (4) | Shared GEDCOM date parsing utility |
| Hot-Patching | (in GraphEngine) | `tests/core/GraphEngineHotPatch.test.ts` ✅ (4) | Add, change, unlink, edge updates |
| Watcher | (in GraphEngine) | `tests/core/Watcher.test.ts` ⏭ SKIPPED (1) | Skipped due to EMFILE; logic verified by HotPatch tests |

**Known deviations from spec** (resolved in Phase 3.5):
- Hot-patching uses "drop all outgoing edges and rebuild" rather than diff-based reconciliation (spec 4.1) → 3.5.4
- ~~`_computed` attributes are not populated during hydration (spec 4.1) → 3.5.2~~ **RESOLVED**
- ~~TransactionManager is minimal (one commit per write, no debouncing) (spec 7.1) → 3.5.1~~ **RESOLVED**
- `isomorphic-git` migration deferred (still uses `simple-git`) → 3.5.1 future

---

### Phase 3.1: Search Infrastructure — COMPLETE ✅

| Item | Status |
|:-----|:-------|
| FlexSearch Document index | ✅ Implemented |
| Person indexing (names, nickname, bio, locations) | ✅ Working |
| `rebuild(graph)` on hydration | ✅ Wired |
| `indexPerson()` / `removePerson()` for hot-patching | ✅ Implemented |
| **Story indexing** | ❌ Stubbed — `rebuild()` skips story nodes |

**File**: `src/core/SearchService.ts` | **Tests**: `tests/core/SearchService.test.ts` (4 passing)

**Remaining work** (deferred to Phase 3.5.6):
- Story nodes not wired into `rebuild()` — search returns `stories: []`
- Place search returns empty `places: []` stub

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
- `GET /system/status` returns hardcoded `hydrationState: "ready"` and `cacheAge: null` → 3.5.3

---

### Phase 3.5: Backend Optimizations — NOT STARTED ❌

These are performance-hardening items that can be implemented incrementally. None block Phase 4 work, but several (especially 3.5.2) improve API correctness.

#### 3.5.1 TransactionManager Refactor — COMPLETE ✅ (except isomorphic-git migration)

Refactored TransactionManager from minimal one-commit-per-write to production-grade debounced write layer.

- [x] **Debounced Commit Queue**: `writeFile()` writes to disk immediately, queues for batched git commit. 5-second debounce timer (configurable). Commit message: `"Update N files: Label1, Label2, ..."` (truncated at 72 chars).
- [x] **Flush on Demand**: `flush()` bypasses debounce, commits immediately. `destroy()` flushes + cleans up timers.
- [x] **Track File**: `trackFile()` for files written by other means (binary uploads) that still need git staging.
- [x] **Wire Snapshot Flush**: `POST /system/snapshot` flushes pending commits before creating git tag.
- [ ] **isomorphic-git Migration**: Deferred. `simple-git` remains for now. Migration is an optimization, not a correctness issue.
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

#### 3.5.3 Tiered Binary Cache

Accelerate boot time for large datasets (10,000+ nodes).

- [ ] **Serialize**: Write validated graph to `/_meta/.graph-cache.json` at end of hydration. Store `mtime` per source file and `spec_version` header.
- [ ] **Incremental Boot**: On startup, load cache. If `spec_version` mismatches or cache is missing → full Nuclear Hydration. Otherwise compare `mtime` per YAML file, re-parse only stale ones.
- [ ] **Cache Write**: Serialize updated cache after every successful hydration (full or incremental).
- [ ] **`cacheAge` in Status API**: `GET /system/status` returns actual `cacheAge` from cache file timestamp (currently hardcoded `null`).
- [ ] **`hydrationState` Tracking**: Track and expose `hydrationState` (`"loading"` during hydration, `"ready"` after) in `GET /system/status` (currently hardcoded `"ready"`).
- [ ] **TDD**: `tests/core/GraphCache.test.ts` — Cache hit skips parsing. Stale `mtime` triggers re-parse. Missing cache → full hydration. Version mismatch → full hydration.

#### 3.5.4 Diff-Based Edge Reconciliation

Replace the current "drop all edges and rebuild" hot-patching with precise edge diffing.

- [ ] **Edge Diffing**: Compare old vs. new parsed state of a YAML file. Apply minimal edge additions/removals for `relationships.parents`, marriage/divorce `partner_id`, and `assets`.
- [ ] **Neighbor Cascade**: After reconciliation, trigger `_computed` invalidation and SearchService incremental update for all affected neighbors.
- [ ] **Mini-Hydration Fallback**: If diff produces inconsistent state (orphaned edges), drop and rebuild all edges for the affected node and immediate neighborhood.
- [ ] **TDD**: `tests/core/GraphEngine.test.ts` — Adding parent adds exactly one edge. Removing parent drops exactly one edge. Unrelated edges untouched. Orphan triggers fallback.

#### 3.5.5 Worker Thread Hydration (Deferred)

For datasets at 50,000+ node scale. Optimization layer only — does not change BootLoader logic.

- [ ] **Worker Script**: `src/core/HydrationWorker.ts` — Run BootLoader inside `worker_threads`.
- [ ] **Handoff**: Worker serializes validated node map + edge list via `postMessage`. Main thread constructs Graphology graph.
- [ ] **Loading State**: `GET /system/status` returns `hydrationState: "loading"`. API returns 503 until ready.
- [ ] **TDD**: `tests/core/HydrationWorker.test.ts` — Worker produces identical output. Main thread stays responsive.

#### 3.5.6 SearchService Improvements

- [ ] **Story Indexing**: Wire story nodes into `rebuild()` and `search()` results.
- [ ] **Place Search**: Extract unique locations from events across all people. Return matching places in `search()` response `places` array (spec Section 5.2).
- [ ] **Hot-Patch Wiring**: Incremental update/remove FlexSearch entries on chokidar events (add/update on `change`/`add`, remove on `unlink`) instead of full `rebuild()`.
- [ ] **TDD**: `tests/core/SearchService.test.ts` — Change a person's name, confirm search returns new name not old. Story search returns matching stories. Place search returns matching locations.

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

### Phase 4: Frontend — NOT STARTED ❌

Build the "VS Code for Genealogy" interface. Start with the Person Detail page to expose API design issues early.

#### 4.1 Scaffolding & Design System
- [ ] Vite + React + TypeScript + TanStack Router
- [ ] TanStack Query for caching and optimistic updates
- [ ] Tailwind CSS with Dark Mode palette (Slate/Zinc/Neutral)
- [ ] Typography: `Inter` (UI), `Fira Code` (Data), `Merriweather` (Stories)
- [ ] Base components: `Button`, `Input`, `Modal` (radix-ui primitives)
- [ ] `Avatar` component (image or initials)
- [ ] `CmdK` Command Palette

#### 4.2 The "Holy Grail" Person Detail Page
- [ ] CSS Grid 3-column layout (Fixed Left, Scrollable Center, Collapsible Right)
- [ ] **Timeline Feed** (center): Consume `TimelineSlicer` output, render `EventCard` and `Gap` components
- [ ] **Identity Panel** (left): Bio, stats, relationship chips from `_computed`
- [ ] **Context Panel** (right): Assets grid, Markdown Notebook (`scrapbook_md`), Raw YAML tab
- [ ] Inline editing for simple fields (Name, Birth Date)
- [ ] Embedded Markdown editor for `scrapbook_md`

#### 4.3 Dashboard
- [ ] Stats panel: Total People, Total Families, Last Edited File
- [ ] Force graph visualization (`react-force-graph-2d`)
- [ ] "Gravity Bands" (position nodes by birth year on Y-axis)

#### 4.4 E2E Tests (Playwright)

Spec Section 9.3. Critical user journeys validated end-to-end.

- [ ] Playwright setup with Vite dev server integration
- [ ] **CUJ: Import Flow**: Upload GEDCOM → Wait for hydration → Verify node count
- [ ] **CUJ: Holy Grail**: Navigate to Person → Edit Note → Save → Verify persistence
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

---

### Phase 6: Distribution & Deployment — NOT STARTED ❌

- [ ] **Docker**: Multi-stage `Dockerfile` (Build Frontend → Serve Backend)
- [ ] **Electron**: Desktop wrapper for local-file-system access
- [ ] **CI/CD**: GitHub Action running Vitest + Playwright (from Phase 4.4) on PRs

---

## 3. Test Suite

**Total**: 112 tests | **Passing**: 111 | **Skipped**: 1 | **Failing**: 0

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
| GraphLogic | `tests/core/GraphLogic.test.ts` | 8 | ✅ |
| HotPatch | `tests/core/GraphEngineHotPatch.test.ts` | 4 | ✅ |
| SearchService | `tests/core/SearchService.test.ts` | 4 | ✅ |
| StoryLoader | `tests/core/StoryLoader.test.ts` | 1 | ✅ |
| Thumbnailer | `tests/core/Thumbnailer.test.ts` | 8 | ✅ |
| TransactionManager | `tests/core/TransactionManager.test.ts` | 7 | ✅ |
| DateParser | `tests/utils/DateParser.test.ts` | 4 | ✅ |
| GEDCOM Import | `tests/core/gedcom/Import.test.ts` | 3 | ✅ |
| GEDCOM Export | `tests/core/gedcom/Export.test.ts` | 6 | ✅ |
| GEDCOM RoundTrip | `tests/core/gedcom/RoundTrip.test.ts` | 2 | ✅ |
| GEDCOM Robustness | `tests/core/gedcom/Robustness.test.ts` | 5 | ✅ |
| API Server | `tests/api/Server.test.ts` | 21 | ✅ |
| TimelineSlicer | `tests/core/TimelineSlicer.test.ts` | 7 | ✅ |
| Authentication | `tests/api/Auth.test.ts` | 11 | ✅ |
| Watcher | `tests/core/Watcher.test.ts` | 1 | ⏭ Skipped |

**Skipped test justification**: `Watcher.test.ts` causes EMFILE (too many open files) when run in parallel. The underlying hot-patch logic is fully verified by `GraphEngineHotPatch.test.ts` (4 tests). The issue is system file descriptor limits, not a code bug.

---

## 4. Technical Decisions

Decisions made during implementation that deviate from or elaborate on the spec.

| # | Decision | Rationale |
|:--|:---------|:----------|
| 1 | Use `nanoid()` for media upload filenames | Prevents collisions, URL-safe, preserves file extension |
| 2 | GEDCOM import is destructive (deletes all `*.yaml`) | Clean slate prevents orphaned data; `.git` history preserved |
| 3 | Snapshot uses `simple-git` (not `isomorphic-git` yet) | Already a dependency. Migration deferred to 3.5.1 TransactionManager refactor |
| 4 | Snapshot auto-creates initial commit if HEAD missing | Handles fresh repos gracefully without requiring manual setup |
| 5 | API Server tests init a git repo in `tests/fixtures/data/` | Required for snapshot endpoint testing; created in `beforeEach` |
| 6 | Auth is optional (graceful degradation) | If `/_meta/auth.yaml` missing, all routes remain public. Allows dev/testing without auth setup |
| 7 | `bcryptjs` over `bcrypt` for password hashing | Pure JS — no native compilation required, easier cross-platform deployment |
| 8 | Auth tests use isolated `tests/fixtures/auth-data/` directory | Prevents race conditions with parallel `Server.test.ts` which shares `tests/fixtures/data/` |
| 9 | GraphEngine re-created per `createServer()` call | Fixes singleton leakage across parallel test files; `onClose` hook nulls the reference |

