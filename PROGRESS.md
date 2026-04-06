# LegacyGraph: Implementation Progress & Roadmap

> Single source of truth for implementation status. See `SPECIFICATION.md` for the full technical spec.

---

## Completed

| Phase | Description |
|:------|:------------|
| 1 & 2 | Core Logic: Schemas, GraphEngine, BootLoader, GraphLogic, StoryLoader, TransactionManager, DateParser, HotPatch, Watcher |
| 3.1 | Search Infrastructure: FlexSearch Document index — people, stories, places |
| 3.2 | GEDCOM Interchange: Import + Export + RoundTrip + Robustness (25 tests) |
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
| 3.15 | Place / Geo-tagging: `PlaceSchema` + `GeocodingService` (Nominatim, rate-limit, disk cache); `EventSchema.location` is now `Place \| undefined` (union auto-coerces bare strings); `GET /api/places/search` + `POST /api/places/resolve`; `PlaceSearchCombobox` in EventEditorDialog with lat/lng badge |
| 4.1–4.8 | Frontend Foundation: App shell, Hydration overlay, Command Palette, People Browse, Person Detail (Holy Grail 3-column), Event & Relationship Editors, Import page, Settings page |
| 4.8 | E2E Tests (Playwright): 3 CUJs — import-view-edit, search-navigation, responsive-layout |
| 4.9 | Dashboard Force Graph: `react-force-graph-2d` with Y-gravity bands, sex-colored nodes with glow, parent→child directional arrows, amber spouse edges (dashed for divorced/widowed), click-to-navigate, fit-to-view. Backend: `GET /api/graph` endpoint |
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
| 5.1 | Stories System: `StorySchema` extended (`date`, `place`, `private`, `people`); `StoryFeedItem` + `FullStory` types; full CRUD API (`GET/POST/PUT/DELETE /api/stories`, `PUT /api/stories/:id/media`); 18 backend tests; `/stories` feed page (virtualised, sort, search with full enriched StoryFeedItem results, delete, whole-card clickable, filter/sort persisted in Zustand); `/stories/:id` reader (Merriweather, filmstrip, `@N_xxx`→`InlinePersonMention` with HoverCard, clickable "Stories" breadcrumb); `/stories/new` + edit mode (Milkdown Crepe WYSIWYG — ListItem, LinkTooltip, ImageBlock, BlockEdit, Table, Toolbar, Cursor, Placeholder; `@N_xxx` chips via ProseMirror decorations; `SmartDateInput` for date, `PlaceSearchCombobox` for geocoded place; @mentions auto-populate `people` array on save, 3s auto-save, drag-drop upload); `MentionList.tsx` dropdown shows name + birth year; Person Notebook uses Milkdown Crepe; unified 720px width for view+edit; static TopBar breadcrumb removed; backend excerpts strip markdown formatting; Stories added to sidebar |
| 5.4 | Asset Gallery: `GET /api/assets` (list+refs+orphan), `PUT /api/assets/:fn/meta`, `DELETE /api/assets/:fn` (orphan guard), `PUT /api/people/:id/events/:eventId/media`, `POST /api/people/:id/assets/link`; virtualised 3-col gallery; orphan filter; sort; inline description edit; lightbox; delete confirm; Assets nav item; AssetPickerDialog; event attachment section in EventEditorDialog; "Search existing" in person page Assets tab |
| 5.4b | Asset System Overhaul: single source of truth (`person.assets[]`); removed `tagged_people` from `AssetMetadataSchema`; `caption`→`description` with backwards-compat transform; `date_taken` surfaced in UI; `DELETE /api/people/:id/media/:filename` changed to unlink-only; new `DELETE /api/people/:id/assets/link/:filename` explicit unlink endpoint; `GET /api/assets` gains `?q=` (search filename/description/person names/story titles), `?type=` (all/image/document), `?sort=` + `?order=` server-side params; `PUT /api/assets/:fn/meta` accepts `description`+`date_taken`; `AssetDetailModal` replaces simple lightbox (left image + right metadata panel, ←/→ keyboard nav, person tag/untag via `PersonSearchCombobox`, orphan delete); card redesign (4:3 aspect ratio, `object-contain`, no fixed height); `PersonSearchCombobox` extracted as shared component; person page removes "Tagged In" section (unified `person.assets[]` is single source); 321 backend tests |
| 5.4c | Bulk Upload from Gallery: `POST /api/assets/upload` (multipart, multi-file, EXIF seed, dedup, rejected[] list); 6 new backend tests (370 total); `BulkUploadDialog` (drag-drop zone, image previews, shared metadata form — description/date/location/people tagging, rejected file list); `uploadGalleryAssets()` + `useUploadGalleryAssets()` in API layer; Upload button in gallery toolbar; `PlaceCombobox` exported from `AssetLightbox.tsx` for reuse |
| 5.5 | Dashboard Visualization Modes: mode toggle segmented control (Force Graph / Fan Chart / Pedigree) in panel header; **Fan Chart** — full 360° SVG circle centered in viewport with Ahnentafel ancestor slots, hue-interpolated paternal (blue 220°) → maternal (rose 340°) lineage colors, auto-scaling ring widths, gen depth selector (3–6), root circle, arc labels, pointer-drag pan + wheel zoom (cursor-relative), click arc to re-root chart, `data-testid="fan-chart-svg"`, `FanChartPanel.tsx`; **Pedigree Chart** — bidirectional adaptive tree (ancestors + descendants from focal person), simplified Reingold-Tilford layout adapts to actual subtree sizes, horizontal/vertical toggles with `aria-pressed`, pointer-drag pan + wheel zoom (5px threshold for click-vs-drag), progressive disclosure (expand chevrons on boundary cards for ancestors/descendants/siblings), person preview popover (desktop ≥640px) or bottom sheet (mobile <640px) with "Make focal person" re-root + "View profile" navigation, responsive card sizing, `data-testid="pedigree-svg"`, `PedigreePanel.tsx`; pure TS layout utilities (`genealogyLayout.ts`): `buildAncestorTree`, `computeFanArcLayout`, `buildFamilyTree` (bidirectional BFS with expansion state), `computeAdaptiveTreeLayout` (Reingold-Tilford); types: `FamilyTreeNode`, `PositionedTreeNode`, `TreeConnector`; state persisted to `dashboard-state-v1` localStorage (vizMode, fanMaxGen, pedigreeOrientation, positions, zoom, rootPersonId); migrates from `fg-state-v5` on first load; 32 unit tests in `tests/core/genealogyLayout.test.ts`; 20 Playwright E2E tests in `tests/e2e/dashboard-viz-modes.test.ts` |

---

## Remaining Work

### Phase 5 — Immersion, Narrative & Full Vision

#### 5.2 Map View (`/map`)
1. `npm install react-leaflet leaflet` in `client/`.
2. `/map` route (`client/src/routes/map.lazy.tsx`) — Leaflet map, OpenStreetMap tiles.
3. Fetch all people via `GET /api/people` (paginated loop); collect geocoded Place objects from events.
4. Render pins by event type (color-coded). Click pin → popup with person link + event details.
5. Marker clustering (`react-leaflet-markercluster`) for dense areas.
6. Filters: by event type, by person (search selector), by date range (year slider).
7. Deep-link support: `/map?place=...` centers map; `/map?person=N_xxx` filters to one person's locations.
8. Add Map (Globe) icon + link to sidebar nav.

#### 5.5 Private Mode & Guest Mode
1. Add `private?: boolean` to `PersonSchema` (optional, default `false`). Update Zod schema and YAML writer.
2. Identity Panel: lock icon toggle → calls `PUT /people/:id` with `private: true/false`.
3. API middleware: if no valid JWT and auth is configured, filter `private: true` persons from all list/search responses. Return 404 (not 403) for direct `GET /people/:id` on private persons.
4. Frontend: respect auth state — if guest, private persons hidden. Witness events referencing private persons show "Private Individual".
5. "Living Surname" display (Phase 6+): living persons (no death event) with `private: true` shown as "Living [LastName]" in guest mode.

#### 5.6 Command Palette — Commands Category
1. Define static `COMMANDS` array in `client/src/components/CommandPalette.tsx` (Create Person, Import GEDCOM, Export GEDCOM, Switch Theme, Create Snapshot, Force Rebuild, View Map, View Assets).
2. Render "Commands" as a 4th `CommandGroup` in the palette.
3. Filter commands by query string (simple `includes` match on command label).
4. Wire actions: navigation commands use `router.navigate()`, theme toggle calls Zustand, export triggers file download.

#### 5.7 Additional Event Types
Add to `EventSchema` discriminated union and Event Editor UI:
- `cremation` (no extra fields)
- `adoption` (field: `adoptive_parent_ids: string[]`)
- `engagement` (field: `partner_id: string`)
- `emigration` (no extra fields beyond base — location is the destination)
- `military_service` (fields: `branch: string`, `rank?: string`)
- `graduation` (fields: `institution: string`, `degree: string`)

Update Event Editor type selector dropdown and conditional field rendering.
TDD: `tests/schemas/EventSchema.test.ts` — new types parse, round-trip, export.

#### 5.8 Git History & Recovery

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

### Dependency Maintenance — TypeScript 6 Upgrade — COMPLETE

Shipped 2026-04-06 on branch `chore/typescript-6-upgrade`. `typescript-eslint@8.58.0` (merged PR #12124, 2026-03-29) relaxed the peer dep to `>=4.8.4 <6.1.0`, unblocking the upgrade.

**Changes made:**
- Root `package.json`: `typescript` → `^6.0.2`, `typescript-eslint` → `^8.58.0`, removed dead `ts-node` dep.
- `client/package.json`: `typescript` → `~6.0.2`, `typescript-eslint` → `^8.58.0`.
- `client/tsconfig.json` + `client/tsconfig.app.json`: removed `"baseUrl": "."` (deprecated in TS6; `paths` works standalone).
- No new lint errors introduced by the updated `tseslint.configs.recommended`.

---

### Phase 6 — Distribution & Deployment

1. **Docker**: Multi-stage `Dockerfile` — build frontend (`npm run build` in `client/`), copy `client/dist/` into backend, serve via `@fastify/static`.
2. **Electron**: Desktop wrapper with `nodeIntegration` for local file-system access; bundle backend + frontend.
3. **CI/CD**: GitHub Action on PRs — `npm test` (Vitest, all 266+) + `npm run test:e2e` (Playwright, all CUJs).
4. **"Living Surname"** anonymization: Living persons (no death event) with `private: true` displayed as "Living [LastName]" in guest/unauthenticated mode. Requires Phase 5.6.
5. **GEDCOM Export UI**: Trigger from Command Palette "Export GEDCOM" command → `GET /api/export/gedcom` → browser download.
