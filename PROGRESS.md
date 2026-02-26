# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. See `SPECIFICATION.md` for the full technical spec.

**Last Updated**: 2026-02-25
**Test Suite**: 232 passing, 0 skipped (31 files)
**Overall Completion**: ~95%

---

## Completed

All backend phases (1–3.14) and all frontend phases (4.1–4.22, except 4.9 force graph) are complete.

| Phase | Description |
|:------|:------------|
| 1 & 2 | Core Logic: Schemas, GraphEngine, BootLoader, GraphLogic, StoryLoader, TransactionManager, DateParser, HotPatch, Watcher |
| 3.1 | Search Infrastructure: FlexSearch Document index — people, stories, places |
| 3.2 | GEDCOM Interchange: Import + Export + RoundTrip + Robustness (16 tests) |
| 3.3 | Media Services: Sharp → WebP thumbnails, mtime cache |
| 3.4 | API Server & Auth: full CRUD, system, auth endpoints; optional JWT auth |
| 3.5 | Backend Optimizations: debounced TransactionManager, `_computed` cache, tiered GraphCache, diff-based edge reconciliation, worker thread hydration, SearchService (stories+places), TimelineSlicer |
| 3.6 | Production Hardening: isomorphic-git migration, @parcel/watcher migration, API pagination |
| 3.7 | Data Layer Hardening: Slim Nodes, Search Index Persistence, Write-Event Deduplication |
| 3.8 | Pre-Frontend Hardening: `applyWriteSideEffects()`, server decomposition to route plugins, SSE hydration stream, O(1) search tracking, story hot-watching |
| 3.9 | More Backend Hardening: file watcher circuit breaker, graceful shutdown flush, static asset delivery |
| 3.10 | Final Data Layer Hardening: cache/worker handoff stripping, debounced search index persistence |
| 3.11 | Human-Readable IDs: `N_[first]-[last]-[birthyear]-[place]-[nanoid8]` |
| 3.12 | GEDCOM Import: accepts multipart FormData (file field) from frontend; replace/additive modes with name+birthyear dedup |
| 3.13 | Fuzzy Date Parsing: BET midpoint, BEF prior year, month-only, day+month formats |
| 3.14 | Asset Deletion API: `DELETE /people/:id/media/:filename` → 204 |
| 4.1–4.8 | Frontend Foundation: App shell, Hydration overlay, Command Palette, People Browse, Person Detail (Holy Grail 3-column), Event & Relationship Editors, Import page, Settings page |
| 4.8 | E2E Tests (Playwright): 3 CUJs — import-view-edit, search-navigation, responsive-layout |
| 4.10 | Search Results Page: `/search?q=` with categorized, paginated, virtualized results |
| 4.11 | Frontend Date Validation: `SmartDateInput` + `parseToISO()`; disables Save on unparseable date |
| 4.12 | Notebook Markdown Rendering: `react-markdown` + `remark-gfm` + `@tailwindcss/typography` |
| 4.13 | Timeline "Unknown Date" Section: undated events prepended with header |
| 4.14 | Sibling Management: Siblings tab in RelationshipEditorDialog |
| 4.15 | Asset Deletion Frontend: `useDeleteAsset` + ConfirmDialog wired to DELETE endpoint |
| 4.16 | Avatar & Asset Quality: `object-cover` on AvatarImage, `primaryAsset` in SlimPersonSummary, optimistic delete |
| 4.17 | Dark/Light Mode: Sun/Moon toggle in TopBar, FOUC prevention, `dark:prose-invert` |
| 4.18 | People List Server-Side Search: switches to `GET /api/search` when query active |
| 4.19 | GEDCOM Spouse Import Fix: creates marriage events when FAM has HUSB+WIFE but no MARR |
| 4.20 | Timeline Virtualizer Reload Fix: `h-full` layout chain + `timelineKey` remount |
| 4.21 | Sibling Dual-Parent Selection: multi-select checkboxes for all current person's parents |
| 4.22 | Strict Date Input Validation: explicit fuzzy-prefix regex replaces catch-all `\b(\d{4})\b` |

---

## Remaining Work

### Phase 3.15 — Place / Geo-tagging

Schema-breaking change. Complete backend before any frontend work. **Required by Phase 5.3 (Map View) and EventCard map snippets.**

1. **Schema** (`src/schemas/EventSchema.ts`): Add `PlaceSchema { name, historicalName?, lat?, lng?, countryCode?, resolvedAt? }`. Change `location` to `z.union([z.string(), PlaceSchema])` with auto-coerce of string → `{ name }`.
2. **BootLoader migration**: During hydration, coerce bare string locations to `{ name }` in-memory — no file writes.
3. **`GeocodingService`** (`src/core/GeocodingService.ts`): `resolve(name): Promise<Place>`. Nominatim REST API (`/search?q=...&format=jsonv2&limit=1`). Cache in `/_meta/.geocode-cache.json`. Rate limit ≤1 req/sec. Graceful fallback returns `{ name }` on any failure.
4. **`GET /api/places/search?q=`** in `src/api/routes/search.ts`: Returns top 5 Nominatim candidates for type-ahead autocomplete.
5. **TDD**: `tests/core/GeocodingService.test.ts` (resolve, cache hit, rate limit, fallback, historical name). Update `tests/schemas/EventSchema.test.ts` (string coerce, Place round-trip).
6. **Frontend** (`EventEditorDialog`): Replace plain text location field with type-ahead against `GET /api/places/search`. Show lat/lng confirmation after resolution.
7. **EventCard map snippet**: After Phase 3.15 backend is complete, `EventCard` in the Person Detail Timeline shows a small static map thumbnail for events with geocoded `lat`/`lng`. Clicking opens `/map?place=...`.

---

### Phase 4.9 — Dashboard Force Graph

Standalone frontend feature. No backend changes needed. **Prerequisite for Phase 5.5 (visualization mode toggle).**

1. `npm install react-force-graph-2d` in `client/`.
2. Fetch all people via paginated `GET /api/people` (loop until all pages loaded).
3. Build edges from `_computed.children` on each person node. Include spouse edges (from `_computed.allSpouses`) with dashed style for divorced/widowed.
4. Render graph in `client/src/routes/index.lazy.tsx` below stats cards.
5. Click node → navigate to `/people/$id`.
6. **"Gravity Bands"**: Position nodes vertically by birth year — Y-axis pulled to horizontal generational bands. X-axis families cluster together.
7. Drag-to-rearrange with spring-back on release.

---

### Phase 5 — Immersion, Narrative & Full Vision

#### 5.1 Stories System (Backend + Frontend)

**Backend:**
1. Add `GET /api/stories` — paginated list: `{ stories: StoryFeedItem[], totalCount }`. `StoryFeedItem`: `{ id, title, date, people: string[], place?, excerpt, firstAsset? }`.
2. Add `GET /api/stories/:id` — full story: frontmatter + body Markdown.
3. Add `POST /api/stories` — create new Markdown file in `stories/`.
4. Add `PUT /api/stories/:id` — update frontmatter + body.
5. Add `DELETE /api/stories/:id` — delete Markdown file.
6. Add `PUT /api/stories/:id/media` — attach asset to story (multipart).
7. Extend `StorySchema` with `date` (date range string), `place`, `private` fields.
8. TDD: `tests/api/Stories.test.ts` — CRUD round-trip, mention extraction, asset attachment.

**Frontend:**
1. `/stories` route (`client/src/routes/stories/index.lazy.tsx`) — virtualized `StoryFeedCard` list. Sort toggle. Inline search.
2. `/stories/:id` route (`client/src/routes/stories/$id.lazy.tsx`) — Story Reader (Merriweather serif, filmstrip at bottom) + Editor toggle (split pane: Markdown left / preview right).
3. Slash commands in editor: `/image` (asset picker) and `/person` (person selector).
4. `@Mention` type-ahead: debounced `GET /api/search?q=` → inserts `@N_xxx` inline.
5. Add Stories icon + link to sidebar nav.
6. `npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-mention` in `client/`.
7. E2E test: Create story → add @mention → verify appears on mentioned person's timeline.

#### 5.2 The "Fly-Through" Timeline (3D Immersive Mode)
1. `npm install three @react-three/fiber` in `client/`.
2. Tunnel geometry: timeline events positioned at Z-depth proportional to `sort_date` year.
3. **Scroll-based camera** movement along the tunnel axis (scroll wheel moves "forward" into the past).
4. **Year depth markers**: floating year labels pass by as depth indicators.
5. **Ancestor photo cards**: persons with assets display a floating card (avatar + name) at their birth-year Z-depth.
6. Accessible fallback: 2D list view when WebGL is unavailable (`<canvas>` detection).
7. E2E test: Load view → Scroll → Verify camera Z position changes → Verify photo card appears at correct year.

#### 5.3 Map View (`/map`)
1. `npm install react-leaflet leaflet` in `client/`.
2. `/map` route (`client/src/routes/map.lazy.tsx`) — Leaflet map, OpenStreetMap tiles.
3. Fetch all people via `GET /api/people` (paginated loop); collect geocoded Place objects from events.
4. Render pins by event type (color-coded). Click pin → popup with person link + event details.
5. Marker clustering (`react-leaflet-markercluster`) for dense areas.
6. Filters: by event type, by person (search selector), by date range (year slider).
7. Deep-link support: `/map?place=...` centers map; `/map?person=N_xxx` filters to one person's locations.
8. Add Map (Globe) icon + link to sidebar nav.
9. Note: requires Phase 3.15 (geo-tagging) to be complete first.

#### 5.4 Asset Gallery (`/assets`)
1. New `GET /api/assets` endpoint: list all files in `/assets/` with `{ filename, size, mimeType, referencedBy: string[] }`. Orphaned = `referencedBy.length === 0`.
2. `/assets` route (`client/src/routes/assets.lazy.tsx`) — masonry/grid of thumbnails.
3. "Orphaned" badge + "Show only orphans" filter.
4. Inline caption editing (calls new `PUT /api/assets/:filename/meta`).
5. Orphan bulk-delete with confirmation dialog.
6. Click image → lightbox (`object-contain`).
7. Add Assets (Image) icon + link to sidebar nav.

#### 5.5 Dashboard Visualization Modes (Fan Chart + Pedigree Chart)
1. Toggle UI (segmented control) between Force Graph / Fan Chart / Pedigree Chart.
2. **Fan Chart**: implement ancestor semi-circle using D3 or `@nivo/sunburst`. Root person selector (search input). Color-coded by paternal/maternal lineage.
3. **Pedigree Chart**: standard horizontal tree using D3 tree layout. Click node → navigate. Scroll/pan for large trees.
4. Persist selected mode to Zustand store (session-level, not localStorage).
5. Phase 4.9 Force Graph moves here (force graph implementation is prerequisite).

#### 5.6 Private Mode & Guest Mode
1. Add `private?: boolean` to `PersonSchema` (optional, default `false`). Update Zod schema and YAML writer.
2. Identity Panel: lock icon toggle → calls `PUT /people/:id` with `private: true/false`.
3. API middleware: if no valid JWT and auth is configured, filter `private: true` persons from all list/search responses. Return 404 (not 403) for direct `GET /people/:id` on private persons.
4. Frontend: respect auth state — if guest, private persons hidden. Witness events referencing private persons show "Private Individual".
5. "Living Surname" display (Phase 6+): living persons (no death event) with `private: true` shown as "Living [LastName]" in guest mode.

#### 5.7 Event Witnessing
1. Add `witness_ids?: string[]` to `BaseEventSchema` in `src/schemas/EventSchema.ts`.
2. Event Editor: multi-select person picker for "Witnesses" field (all event types).
3. `TimelineSlicer`: for each person requested, also collect events from other people where that person appears in `witness_ids`. Return as `WitnessEvent` items.
4. Frontend: `WitnessEventCard` component (distinct "eye" icon, "Witness at [Subject]'s [type]" label, `PersonChip` link to subject).
5. TDD: `TimelineSlicer` test — witness events appear on witness's timeline, not subject's primary events.

#### 5.8 Command Palette — Commands Category
1. Define static `COMMANDS` array in `client/src/components/CommandPalette.tsx` (Create Person, Import GEDCOM, Export GEDCOM, Switch Theme, Create Snapshot, Force Rebuild, View Map, View Assets).
2. Render "Commands" as a 4th `CommandGroup` in the palette.
3. Filter commands by query string (simple `includes` match on command label).
4. Wire actions: navigation commands use `router.navigate()`, theme toggle calls Zustand, export triggers file download.

#### 5.9 Additional Event Types
Add to `EventSchema` discriminated union and Event Editor UI:
- `cremation` (no extra fields)
- `adoption` (field: `adoptive_parent_ids: string[]`)
- `engagement` (field: `partner_id: string`)
- `emigration` (no extra fields beyond base — location is the destination)
- `military_service` (fields: `branch: string`, `rank?: string`)
- `graduation` (fields: `institution: string`, `degree: string`)

Update Event Editor type selector dropdown and conditional field rendering.
TDD: `tests/schemas/EventSchema.test.ts` — new types parse, round-trip, export.

#### 5.10 Git History & Recovery

Full spec in SPECIFICATION.md Sections 6.12, 7.1, and 7.2.

**Backend (TDD — write failing tests first):**

1. `tests/api/GitHistory.test.ts` — new test file (~18 tests covering all new endpoints below)
2. `tests/core/TransactionManager.test.ts` — add 8 tests: semantic messages per `OperationKind`, `getPendingLabels()`, `setBatchHint()`, `flush(messageOverride)`, mixed-kind fallback, legacy format fallback
3. `src/core/TransactionManager.ts` — add `OperationHint` type + `OperationKind` union; add `hint?` param to `writeFile()` and `trackFile()`; add `getPendingLabels(): string[]`, `setBatchHint(hint)`, `flush(messageOverride?)` methods; rewrite `buildCommitMessage()` with semantic dispatch per `OperationKind`
4. `GET /api/system/git-status` — enhanced response: `{ branch, dirty, pendingFiles: string[], hasPending, lastCommit: { hash, fullHash, message, author, timestamp } | null }`. Not 503-gated.
5. `POST /api/system/commit` — flush `TransactionManager` immediately; optional `{ message? }` body → `{ committed: bool, hash, timestamp }`. Not 503-gated.
6. `GET /api/system/git-log` — paginated: `?limit=20&offset=0` → `{ commits[], totalCount, offset, limit }`. Each commit includes `filesChanged` count (tree diff via `git.walk`).
7. `GET /api/system/git-log/:hash` — detail: per-file `{ path, status, before, after }` content via `git.readBlob` + `resolveBlobAtCommit` helper. Binary files: `{ isBinary: true }`. >50 files: `{ truncated: true, totalFiles }`.
8. `GET /api/system/snapshots` — list all git tags → `{ snapshots[] }` sorted newest-first. Handle both annotated and lightweight tags.
9. `DELETE /api/system/snapshots/:name` — `git.deleteTag()`; 204 on success; 404 `SNAPSHOT_NOT_FOUND` if missing. Auth required.
10. `POST /api/system/restore` — body: `{ ref, scope: 'full'|'person', personId?, confirm: true }`. 400 `CONFIRM_REQUIRED` without flag. Full scope: `git.checkout({ force: true })` + `hydrateInBackground()`. Person scope: `resolveBlobAtCommit` → `writeFile` → forward commit + hot-patch.
11. `GET /api/people/:id/history` (in `people.ts`) — path-filtered commit log: walk git log from HEAD (cap 1000), include only commits where person's blob OID changed vs. parent. Same pagination shape as `git-log`.
12. Extend `GET /api/system/status` — add `heapUsedMB`, `heapTotalMB`, `heapWarning` (>75%), `hydrationDurationMs`, `cacheHitRatio`, `gitBranch`, `gitDirty`. Requires new private fields on `GraphEngine` populated after each hydration.
13. Update callsites — pass `OperationHint` to `writeFile`/`trackFile` in `people.ts`, `gedcom.ts`, `stories.ts` (Phase 5.1). Use `setBatchHint()` after GEDCOM import to produce `"Import N people from file.ged"`.

**Frontend (after all backend tests pass):**

14. `client/src/api/hooks.ts` — add hooks: `useGitStatus()` (adaptive polling: 5s dirty, 30s clean), `useGitLog(params)`, `useGitCommitDetail(hash, { enabled })` (staleTime: Infinity — commit content never changes), `useSnapshots()`, `usePersonHistory(personId, params)`, `useCommitNow()` (mutation), `useRestore()` (mutation), `useDeleteSnapshot()` (mutation)
15. `client/src/routes/settings.lazy.tsx` — restructure into 4 sections: System Status (extended with heap/hydration metrics), Git Status (branch badge, pending files list, Commit Now), History Log (paginated expandable commit rows with Restore button), Snapshots (grid of snapshot cards with Restore/Delete)
16. `client/src/components/RestoreDialog.tsx` — new shared component for full-repo and person-scope restore dialogs. Full scope: warning dialog with detached HEAD notice. Person scope: safety notice + semantic diff preview (field-level, not line-by-line: name, event count, asset count).
17. `client/src/components/PersonHistoryTab.tsx` — compact commit list for the narrow right panel; "Restore this version" button per entry; simple Newer/Older pagination
18. `client/src/routes/people/$id.lazy.tsx` — add "History" as 4th tab in Context Panel (alongside Assets / Notebook / Raw YAML); renders `PersonHistoryTab`
19. `client/src/components/Sidebar.tsx` — Settings entry: branch name (muted mono, max 16 chars) + amber `•` dot when dirty; icon-only mode: dot badge on gear icon; data from shared `useGitStatus()` TanStack Query cache (no extra calls)

**Expected test count increase:** ~26 new Vitest tests (18 API in `GitHistory.test.ts` + 8 TransactionManager)

---

### Phase 6 — Distribution & Deployment

1. **Docker**: Multi-stage `Dockerfile` — build frontend (`npm run build` in `client/`), copy `client/dist/` into backend, serve via `@fastify/static`.
2. **Electron**: Desktop wrapper with `nodeIntegration` for local file-system access; bundle backend + frontend.
3. **CI/CD**: GitHub Action on PRs — `npm test` (Vitest, all 232+) + `npm run test:e2e` (Playwright, all CUJs).
4. **"Living Surname"** anonymization: Living persons (no death event) with `private: true` displayed as "Living [LastName]" in guest/unauthenticated mode. Requires Phase 5.6.
5. **Pedigree Chart PNG export**: "Export to PNG" button on Pedigree Chart view. Uses canvas `toDataURL`.
6. **GEDCOM Export UI**: Trigger from Command Palette "Export GEDCOM" command → `GET /api/export/gedcom` → browser download.

---

## Test Suite

232 passing | 0 skipped | 31 files

| Module | File | Count |
|:-------|:-----|:------|
| PersonSchema | tests/schemas/PersonSchema.test.ts | 3 |
| EventSchema | tests/schemas/EventSchema.test.ts | 2 |
| AssetSchema | tests/schemas/AssetSchema.test.ts | 1 |
| StorySchema | tests/schemas/StorySchema.test.ts | 1 |
| AuthSchema | tests/schemas/AuthSchema.test.ts | 5 |
| SchemaExpansion | tests/schemas/SchemaExpansion.test.ts | 6 |
| BootLoader | tests/core/BootLoader.test.ts | 1 |
| GraphEngine | tests/core/GraphEngine.test.ts | 1 |
| GraphCache | tests/core/GraphCache.test.ts | 11 |
| GraphLogic | tests/core/GraphLogic.test.ts | 8 |
| HotPatch | tests/core/GraphEngineHotPatch.test.ts | 8 |
| HydrationWorker | tests/core/HydrationWorker.test.ts | 10 |
| SearchService | tests/core/SearchService.test.ts | 16 |
| StoryLoader | tests/core/StoryLoader.test.ts | 1 |
| Thumbnailer | tests/core/Thumbnailer.test.ts | 8 |
| TransactionManager | tests/core/TransactionManager.test.ts | 8 |
| DateParser | tests/utils/DateParser.test.ts | 8 |
| IdGenerator | tests/utils/IdGenerator.test.ts | 5 |
| GEDCOM Import | tests/core/gedcom/Import.test.ts | 3 |
| GEDCOM Export | tests/core/gedcom/Export.test.ts | 6 |
| GEDCOM RoundTrip | tests/core/gedcom/RoundTrip.test.ts | 2 |
| GEDCOM Robustness | tests/core/gedcom/Robustness.test.ts | 5 |
| API Server | tests/api/Server.test.ts | 30 |
| TimelineSlicer | tests/core/TimelineSlicer.test.ts | 10 |
| Authentication | tests/api/Auth.test.ts | 11 |
| SlimNode | tests/core/SlimNode.test.ts | 10 |
| SearchPersistence | tests/core/SearchPersistence.test.ts | 8 |
| WriteDedup | tests/core/WriteDedup.test.ts | 7 |
| Watcher | tests/core/Watcher.test.ts | 10 |
| HydrationStream | tests/api/HydrationStream.test.ts | 4 |
| MediaDelivery | tests/api/MediaDelivery.test.ts | 3 |
