# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. See `SPECIFICATION.md` for the full technical spec.

**Last Updated**: 2026-02-25
**Test Suite**: 228 passing, 0 skipped (31 files)
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
| 3.12 | GEDCOM Import: accepts multipart FormData (file field) from frontend |
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

Schema-breaking change. Complete backend before any frontend work.

1. **Schema** (`src/schemas/EventSchema.ts`): Add `PlaceSchema { name, historicalName?, lat?, lng?, countryCode?, resolvedAt? }`. Change `location` to `z.union([z.string(), PlaceSchema])` with auto-coerce of string → `{ name }`.
2. **BootLoader migration**: During hydration, coerce bare string locations to `{ name }` in-memory — no file writes.
3. **`GeocodingService`** (`src/core/GeocodingService.ts`): `resolve(name): Promise<Place>`. Nominatim REST API (`/search?q=...&format=jsonv2&limit=1`). Cache in `/_meta/.geocode-cache.json`. Rate limit ≤1 req/sec. Graceful fallback returns `{ name }` on any failure.
4. **`GET /api/places/search?q=`** in `src/api/routes/search.ts`: Returns top 5 Nominatim candidates for type-ahead autocomplete.
5. **TDD**: `tests/core/GeocodingService.test.ts` (resolve, cache hit, rate limit, fallback, historical name). Update `tests/schemas/EventSchema.test.ts` (string coerce, Place round-trip).
6. **Frontend** (`EventEditorDialog`): Replace plain text location field with type-ahead against `GET /api/places/search`. Show lat/lng confirmation after resolution.

---

### Phase 4.9 — Dashboard Force Graph

Standalone frontend feature. No backend changes needed.

1. `npm install react-force-graph-2d` in `client/`.
2. Fetch all people via paginated `GET /api/people` (loop until all pages loaded).
3. Build edges from `_computed.children` on each person node.
4. Render graph in `client/src/routes/index.lazy.tsx` below stats cards.
5. Click node → navigate to `/people/$id`.
6. "Gravity Bands" (position nodes by birth year) — deferred to Phase 5.

---

### Phase 5 — Immersion & Polish

#### 5.1 Rich Story Editor
1. `npm install @tiptap/react @tiptap/starter-kit` in `client/`.
2. Replace Notebook `<textarea>` with Tiptap editor.
3. `@Mention` extension: debounced `GET /api/search?q=` for people type-ahead, inserts `@N_xxx`.
4. `/Asset` slash command: inserts image from `/assets` directory.

#### 5.2 The 3D Time Tunnel
1. `npm install three @react-three/fiber` in `client/`.
2. Tunnel geometry: timeline events positioned at Z-depth proportional to date.
3. Scroll-based camera movement along the tunnel axis.
4. Accessible fallback: 2D list view when WebGL is unavailable.

#### 5.3 Observability & Monitoring
1. Add `heapUsedMB`, `hydrationDurationMs`, `cacheHitRatio` to `GET /system/status` response (extend existing endpoint).
2. Log memory warnings when V8 heap exceeds 75% of limit.

---

### Phase 6 — Distribution & Deployment

1. **Docker**: Multi-stage `Dockerfile` — build frontend (`npm run build` in `client/`), copy `client/dist/` into backend, serve via `@fastify/static`.
2. **Electron**: Desktop wrapper with `nodeIntegration` for local file-system access; bundle backend + frontend.
3. **CI/CD**: GitHub Action on PRs — `npm test` (Vitest, all 228+) + `npm run test:e2e` (Playwright, 3 CUJs).

---

## Test Suite

228 passing | 0 skipped | 31 files

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
