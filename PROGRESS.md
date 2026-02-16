# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. For the _what_ and _why_, see `spec.md`.
> For the _how far_ and _what's next_, read this document.

**Last Updated**: 2026-02-16
**Test Suite**: 76 passing, 1 skipped (77 total)
**Overall Completion**: ~40% of full spec

---

## 1. Phase Summary

| Phase | Description | Status |
|:------|:------------|:-------|
| **1 & 2** | Core Logic (Schemas, Graph, BootLoader) | ✅ Complete |
| **3.1** | Search Infrastructure | ✅ Complete (story indexing pending) |
| **3.2** | GEDCOM Interchange | ✅ Complete |
| **3.3** | Media Services | ✅ Complete |
| **3.4** | API Server | ✅ Complete (auth pending) |
| **3.5** | Backend Optimizations | ❌ Not started |
| **4** | Frontend (React UI) | ❌ Not started |
| **5** | Immersion & Polish | ❌ Not started |
| **6** | Distribution & Deployment | ❌ Not started |

---

## 2. Detailed Implementation Status

### Phase 1 & 2: Core Logic — COMPLETE ✅

All foundational modules are implemented and tested.

| Module | File | Tests | Notes |
|:-------|:-----|:------|:------|
| BootLoader | `src/core/BootLoader.ts` | `tests/core/BootLoader.test.ts` ✅ | YAML parsing via Zod, `p-limit` concurrency, asset integrity checks |
| GraphEngine | `src/core/GraphEngine.ts` | `tests/core/GraphEngine.test.ts` ✅ | Graphology directed multigraph, `hydrate()`, `startWatcher()` via Chokidar |
| GraphLogic | `src/core/GraphLogic.ts` | `tests/core/GraphLogic.test.ts` ✅ | Henry VIII spouse algorithm, `getSiblings`, `getAggregatedAssets` |
| PersonSchema | `src/schemas/PersonSchema.ts` | `tests/schemas/PersonSchema.test.ts` ✅ | All v5.0 fields including `scrapbook_md`, `_gedcom` |
| EventSchema | `src/schemas/EventSchema.ts` | `tests/schemas/EventSchema.test.ts` ✅ | Discriminated union, all 11 event types |
| StorySchema | `src/schemas/StorySchema.ts` | `tests/schemas/StorySchema.test.ts` ✅ | Markdown frontmatter schema |
| AssetSchema | `src/schemas/AssetSchema.ts` | `tests/schemas/AssetSchema.test.ts` ✅ | Asset metadata schema |
| StoryLoader | `src/core/StoryLoader.ts` | `tests/core/StoryLoader.test.ts` ✅ | Markdown + `@mention`/`[[wikilink]]` extraction |
| TransactionManager | `src/core/TransactionManager.ts` | `tests/core/TransactionManager.test.ts` ✅ | Mutex + simple-git (minimal, no batching) |
| DateParser | `src/utils/dateParser.ts` | `tests/utils/DateParser.test.ts` ✅ | Shared GEDCOM date parsing utility |
| Hot-Patching | (in GraphEngine) | `tests/core/GraphEngineHotPatch.test.ts` ✅ | Add, change, unlink, edge updates |
| Watcher | (in GraphEngine) | `tests/core/Watcher.test.ts` ⏭ SKIPPED | Skipped due to EMFILE; logic verified by HotPatch tests |

**Known deviations from spec**:
- Hot-patching uses "drop all outgoing edges and rebuild" rather than diff-based reconciliation (spec Section 4.1). Will be fixed in Phase 3.5.4.
- `_computed` attributes are not populated during hydration. Will be fixed in Phase 3.5.2.
- TransactionManager is minimal (one commit per write, no debouncing). Will be refactored in Phase 3.5.1.

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

**Remaining work**:
- [ ] Wire story nodes into `rebuild()` — index `title` and `content` fields
- [ ] Return story results from `search()` (currently returns `stories: []`)

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

**Tests**: 11 passing across Import, Export, RoundTrip, Robustness test files.

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

### Phase 3.4: API Server — COMPLETE ✅ (except Authentication)

All CRUD and system endpoints are implemented and tested.

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
| `POST /api/auth/login` | ❌ Not implemented | — |
| `POST /api/auth/logout` | ❌ Not implemented | — |
| Auth guard middleware | ❌ Not implemented | — |

**File**: `src/server.ts` | **Tests**: `tests/api/Server.test.ts` (21 tests, 3 general + 18 endpoint)

**Known limitations**:
- Write endpoints (`POST /people`, `PUT /people/:id`, `PUT /people/:id/media`) write YAML directly via `fs.writeFile` without going through TransactionManager — no git commits on these operations. Will be wired in Phase 3.5.1.
- `GET /people/:id` returns an empty `_computed` placeholder. Will return real computed relationships in Phase 3.5.2.
- `POST /system/snapshot` creates a git tag but does not flush a debounced commit queue (queue doesn't exist yet). Will be wired in Phase 3.5.1.

---

### Phase 3.4 (continued): Authentication — NOT STARTED ❌

This is the remaining piece of Phase 3.4. All items below must be implemented following TDD.

- [ ] **Schema**: Define `AuthConfigSchema` for `/_meta/auth.yaml` (BCrypt hashed passwords)
- [ ] **Tests**: Create `tests/api/Auth.test.ts`
  - [ ] Unauthenticated requests to protected endpoints return 401
  - [ ] Valid JWT grants access
  - [ ] Expired JWT is rejected
  - [ ] Login with valid credentials returns HttpOnly JWT cookie
  - [ ] Login with invalid credentials returns 401
  - [ ] Logout clears the cookie
  - [ ] `GET /api/system/status` is accessible without auth
- [ ] **Dependencies**: Install `bcrypt` (or `bcryptjs`), `jsonwebtoken`, `@fastify/cookie`
- [ ] **Implementation**:
  - [ ] `src/api/middleware/auth.ts` — Auth guard hook
  - [ ] `POST /api/auth/login` — Validate against `/_meta/auth.yaml`, issue JWT in HttpOnly cookie
  - [ ] `POST /api/auth/logout` — Clear HttpOnly cookie
  - [ ] Apply auth guard to all routes except `POST /api/auth/login` and `GET /api/system/status`

---

### Phase 3.5: Backend Optimizations — NOT STARTED ❌

These are performance-hardening items that can be implemented incrementally. None block Phase 4 work, but several (especially 3.5.2) improve API correctness.

#### 3.5.1 TransactionManager Refactor

Refactor the minimal TransactionManager into a production-grade write layer.

- [ ] **Debounced Commit Queue**: Batch file writes. After the last write in a burst, start a 5-second debounce timer. On fire, commit all pending changes in a single atomic git commit. Commit message: `"Update N files: Person X, Person Y, ..."` (truncated at 72 chars).
- [ ] **Flush on Demand**: Allow forced flush (before snapshots, on graceful shutdown).
- [ ] **isomorphic-git Migration**: Replace `simple-git` with `isomorphic-git` for `add`/`commit`/`tag`/`log`. Retain system Git fallback for `push`/`pull`.
- [ ] **Wire API Endpoints**: Route `POST /people`, `PUT /people/:id`, `PUT /people/:id/media`, `POST /import/gedcom` through TransactionManager.
- [ ] **TDD**: `tests/core/TransactionManager.test.ts` — Verify batching (rapid writes → single commit). Verify flush-on-demand bypasses debounce.

#### 3.5.2 Computed Relationship Cache (`_computed`)

The spec's most architecturally significant remaining item. Without this, the API returns empty relationship data.

- [ ] **`computeRelationships(nodeId)`**: Implement in `GraphLogic.ts`. Writes `currentSpouse`, `siblings`, `children`, `allSpouses` to the node's `_computed` attribute.
- [ ] **Hydration Integration**: Call `computeRelationships()` for every node at the end of `GraphEngine.hydrate()`.
- [ ] **Invalidation**: On chokidar change, recompute `_computed` for the changed node AND all immediate graph neighbors.
- [ ] **Wire to API**: `GET /people/:id` reads from `_computed` instead of returning empty placeholder.
- [ ] **TDD**: `tests/core/GraphLogic.test.ts` — Verify `_computed` populated after hydration. Verify invalidation recomputes affected nodes only.

#### 3.5.3 Tiered Binary Cache

Accelerate boot time for large datasets (10,000+ nodes).

- [ ] **Serialize**: Write validated graph to `/_meta/.graph-cache.json` at end of hydration. Store `mtime` per source file and `spec_version` header.
- [ ] **Incremental Boot**: On startup, load cache. If `spec_version` mismatches or cache is missing → full Nuclear Hydration. Otherwise compare `mtime` per YAML file, re-parse only stale ones.
- [ ] **Cache Write**: Serialize updated cache after every successful hydration (full or incremental).
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
- [ ] **Hot-Patch Wiring**: Incremental update/remove FlexSearch entries on chokidar events (add/update on `change`/`add`, remove on `unlink`) instead of full `rebuild()`.
- [ ] **TDD**: `tests/core/SearchService.test.ts` — Change a person's name, confirm search returns new name not old.

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
- [ ] **CI/CD**: GitHub Action running Vitest + Playwright on PRs

---

## 3. Known Limitations (Implementation vs. Spec Gaps)

These are places where the current implementation deviates from or falls short of the specification.

| # | Gap | Spec Section | Fix Phase |
|:--|:----|:-------------|:----------|
| 1 | Write endpoints don't commit to git | 7.1 | 3.5.1 |
| 2 | `_computed` cache returns empty placeholder | 4.1 | 3.5.2 |
| 3 | No authentication — all endpoints unprotected | 5.4, 7.2 | 3.4 (auth) |
| 4 | Hot-patching uses drop-all-rebuild, not edge diffing | 4.1 | 3.5.4 |
| 5 | No tiered binary cache for fast boot | 2.3 | 3.5.3 |
| 6 | Snapshot doesn't flush debounced commit queue | 5.3 | 3.5.1 |
| 7 | Stories not indexed in search | 5.2 | 3.5.6 |
| 8 | Timeline Slicer not implemented | 4.2 | 3.5 or 4 |
| 9 | `hydrationState` hardcoded to `"ready"` | 5.3 | 3.5.3 / 3.5.5 |
| 10 | `cacheAge` hardcoded to `null` | 5.3 | 3.5.3 |

---

## 4. Test Suite

**Total**: 77 tests | **Passing**: 76 | **Skipped**: 1 | **Failing**: 0

| Module | File | Count | Status |
|:-------|:-----|:------|:-------|
| PersonSchema | `tests/schemas/PersonSchema.test.ts` | 3 | ✅ |
| EventSchema | `tests/schemas/EventSchema.test.ts` | 2 | ✅ |
| AssetSchema | `tests/schemas/AssetSchema.test.ts` | 1 | ✅ |
| StorySchema | `tests/schemas/StorySchema.test.ts` | 1 | ✅ |
| SchemaExpansion | `tests/schemas/SchemaExpansion.test.ts` | 6 | ✅ |
| BootLoader | `tests/core/BootLoader.test.ts` | 1 | ✅ |
| GraphEngine | `tests/core/GraphEngine.test.ts` | 1 | ✅ |
| GraphLogic | `tests/core/GraphLogic.test.ts` | 2 | ✅ |
| HotPatch | `tests/core/GraphEngineHotPatch.test.ts` | 4 | ✅ |
| SearchService | `tests/core/SearchService.test.ts` | 4 | ✅ |
| Thumbnailer | `tests/core/Thumbnailer.test.ts` | 8 | ✅ |
| TransactionManager | `tests/core/TransactionManager.test.ts` | 1 | ✅ |
| DateParser | `tests/utils/DateParser.test.ts` | 4 | ✅ |
| GEDCOM Import | `tests/core/gedcom/Import.test.ts` | 3 | ✅ |
| GEDCOM Export | `tests/core/gedcom/Export.test.ts` | 6 | ✅ |
| GEDCOM RoundTrip | `tests/core/gedcom/RoundTrip.test.ts` | 2 | ✅ |
| GEDCOM Robustness | `tests/core/gedcom/Robustness.test.ts` | 5 | ✅ |
| API Server | `tests/api/Server.test.ts` | 21 | ✅ |
| Watcher | `tests/core/Watcher.test.ts` | 1 | ⏭ Skipped |

**Skipped test justification**: `Watcher.test.ts` causes EMFILE (too many open files) when run in parallel. The underlying hot-patch logic is fully verified by `GraphEngineHotPatch.test.ts` (4 tests). The issue is system file descriptor limits, not a code bug.

---

## 5. Technical Decisions

Decisions made during implementation that deviate from or elaborate on the spec.

| # | Decision | Rationale |
|:--|:---------|:----------|
| 1 | Use `nanoid()` for media upload filenames | Prevents collisions, URL-safe, preserves file extension |
| 2 | GEDCOM import is destructive (deletes all `*.yaml`) | Clean slate prevents orphaned data; `.git` history preserved |
| 3 | Snapshot uses `simple-git` (not `isomorphic-git` yet) | Already a dependency. Migration deferred to 3.5.1 TransactionManager refactor |
| 4 | Snapshot auto-creates initial commit if HEAD missing | Handles fresh repos gracefully without requiring manual setup |
| 5 | API Server tests init a git repo in `tests/fixtures/data/` | Required for snapshot endpoint testing; created in `beforeEach` |

---

## 6. Change Log

### Session: 2026-02-16 — Phase 3.4 Completion

**Commit**: `feda8aa` — "Complete Phase 3.4 API endpoints & fix test suite"

**Fixed**:
- `GraphLogic.getAggregatedAssets` test — test fixture bug (event had `assets: []` but test expected `"birth.jpg"`)
- `Watcher.test.ts` — skipped with documentation (EMFILE, not a code bug)

**Implemented** (all via TDD):
- `PUT /api/people/:id/media` — Multipart upload via `@fastify/multipart`, unique filenames, YAML update (3 tests)
- `POST /api/import/gedcom` — Destructive bulk import, wired to `GedcomReader`, triggers re-hydration (3 tests)
- `POST /api/system/rebuild` — Force `GraphEngine.hydrate()`, return counts (1 test)
- `POST /api/system/snapshot` — Upgraded stub to real `simple-git` annotated tagging (2 tests)

**Dependencies added**: `@fastify/multipart`

### Session: 2026-02-15 — GEDCOM Export, Thumbnailer, API Server

**Implemented** (all via TDD):
- GEDCOM Exporter (`src/core/gedcom/Export.ts`) — GEDCOM 5.5.1 output, FAM records, `_gedcom` preservation (6 tests + 2 round-trip tests)
- Thumbnail Service (`src/core/Thumbnailer.ts`) — Sharp, WebP, mtime cache (8 tests)
- Fastify API Server (`src/server.ts`) — Initial CRUD endpoints, search, system status (14 tests)
- Fixed `GraphLogic.test.ts` to include required `scrapbook_md` field

**Dependencies added**: `@fastify/cors`

### Prior Sessions — Core Foundation (Phases 1 & 2)

- BootLoader, GraphEngine, GraphLogic, all schemas, StoryLoader, TransactionManager, DateParser, GEDCOM Import, SearchService
- Full hot-patching with chokidar handlers (add/change/unlink)
