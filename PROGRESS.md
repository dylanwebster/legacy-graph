# LegacyGraph: Remaining Work

> See `SPECIFICATION.md` for the full technical spec.

---

## Completed Phases

| Phase | Description |
|:------|:------------|
| 1–2 | Core Logic: Schemas, GraphEngine, BootLoader, GraphLogic, StoryLoader, TransactionManager, DateParser, HotPatch, Watcher |
| 3.1–3.15 | Search (FlexSearch), GEDCOM Import/Export, Media (Sharp thumbnails), API Server & Auth, Backend Optimizations (worker hydration, tiered cache, slim nodes, search persistence, write dedup), Human-Readable IDs, Fuzzy Date Parsing, Asset Deletion, Place/Geo-tagging (GeoNames DB, forward+reverse geocoding, PlaceSearchCombobox) |
| 4.1–4.22 | Frontend Foundation: App shell, Hydration overlay, Command Palette, People Browse, Person Detail (Holy Grail 3-column), Event & Relationship Editors, Import, Settings, Search Results, SmartDateInput, Notebook, Timeline improvements, Dark/Light mode, Server-side search, E2E tests (Playwright) |
| 4.9 | Dashboard Force Graph: `react-force-graph-2d` with Y-gravity, sex-colored nodes, spouse/parent edges, `GET /api/graph` |
| 5.1 | Stories System: Full CRUD, Milkdown Crepe WYSIWYG, @mention chips, auto-save, story feed with filter/sort |
| 5.4–5.4c | Asset System: Single source of truth (`person.assets[]`), gallery with search/filter/sort, AssetDetailModal, bulk upload with EXIF, PersonSearchCombobox, AssetPickerDialog |
| 5.5 | Dashboard Viz Modes: Fan Chart (360 SVG, Ahnentafel, lineage colors, gen depth 3-6), Pedigree Chart (bidirectional Reingold-Tilford, progressive disclosure, popover/bottom sheet), mode toggle, state persistence |
| TS6 | TypeScript 6 upgrade (typescript ^6.0.2, typescript-eslint ^8.58.0) |
| 5.6 | Batch Geocoding: `searchWithMetadata()` with confidence scoring, `/api/geocoding/batch` + `/apply` endpoints, Settings review dialog with filter/search, site_name extraction from dropped parts, original location preservation in `_gedcom.original_locations` |
| 5.6.1 | Async Batch Geocoding: Background job system (`JobManager` with EventEmitter), SSE progress streaming (`/batch/stream`), server-side result persistence (`_meta/.batch-geocode-results.json`), resumable review sessions (selections saved to server), Zustand store for cross-navigation state, non-blocking UI during scan |
| 5.2.0 | Schema 5.1: event date ranges — `end_date`/`sort_end_date` added to `EventSchema`, `PersonSchema` version bumped with auto-migration from `"5.0"`, `parseDateRange()` utility, GEDCOM Import populates ranges from `BET … AND …` and `FROM … TO …`, EventEditorDialog range toggle, PersonTimeline displays spans |

---

## Remaining Work

### Phase 5.2 — Map View (`/map`)

Plan: MapLibre GL + deck.gl overlay + Protomaps (PMTiles) basemap, with zoom-driven crossfade between a heatmap ("earth at night" glow), clustered pins, and jittered per-event pins. Bottom-docked time slider with dual handles drives playback via `requestAnimationFrame`; granularity (year/decade/century) and speed are user-controlled. Scope control (Everyone / Focal person / Focal lineage) shares `useFocalStore` with the Graph page.

Sub-phases:
- [x] **5.2.0** — Schema 5.1 (event date ranges) — `end_date` / `sort_end_date`, auto-migrate from `"5.0"`, GEDCOM `BET…AND` / `FROM…TO` preserved as ranges, EventEditor range toggle.
- [x] **5.2.1** — Shared focal person Zustand store (`useFocalStore`; `rootPersonId` lifted out of `dashboardState`; one-time migration from legacy localStorage blob).
- [x] **5.2.2** — `GraphLogic.getLineage()` (ancestors + descendants + spouses) + `GET /api/map/events` with `?person=` / `?lineage=` filters.
- [x] **5.2.3** — PMTiles basemap pipeline: `npm run map:build` downloads world tiles to `~/.legacy-graph/basemap.pmtiles`; `/api/basemap/tiles` serves HTTP Range requests (200/206/416); `/api/system/basemap` reports availability; OSM raster fallback + banner when missing.
- [x] **5.2.4** — `/map` route scaffolding: MapLibre + deck.gl `MapboxOverlay` + Sidebar Globe icon; day/night styles keyed to `useUIStore.theme`; pmtiles protocol registered with MapLibre.
- [x] **5.2.5** — Zoom-crossfaded render layers: `HeatmapLayer` (tanh-shaped warm-amber ramp, type-weighted intensity) → type-colored `ScatterplotLayer` pins with deterministic hash-based jitter. Opacity crossfade on `zoom` thresholds.
- [x] **5.2.6** — Time window slider + playback: dual-handle window, granularity (year/decade/century), speed (0.5×–4×), loop toggle, RAF playback, pause-on-scrub (no auto-resume), keyboard shortcuts (Space / ← / → / Shift+), "Show undated" mode. Date-range overlap drives visibility.
- [x] **5.2.7** — Scope filter + focal integration: `Everyone` / `Focal person` / `Focal lineage`, persisted in `useMapPrefsStore`. `map.fitBounds` to the filtered bbox on every scope/focal change.
- [x] **5.2.8** — Connected-path single-person view: deck.gl `PathLayer` birth → residences → death when scope is `focal`.
- [x] **5.2.9** — Event drawer (side drawer on desktop, half-height bottom sheet on mobile) with event card, person chip, "Set as focal" + "Open on Graph" actions.
- [x] **5.2.10** — Deep-link contract: `/map?scope=&person=&t=&t_end=&g=&speed=&play=&loop=&event=` fully round-trips (boot from URL on mount, debounced write-back on store change via `navigate({ replace: true })`).
- [x] **5.2.11** — Mobile: toolbar horizontally scrollable with compact labels; drawer becomes a half-height bottom sheet; slider remains bottom-docked at narrow widths.
- [x] **5.2.12** — Command palette: "View Map" and "Show focal lineage on Map" actions (the latter shown only when a focal is set).
- [x] **5.2.13** — Docs updated (SPEC §6.11 rewritten; PROGRESS updated). E2E tests deferred to follow-up.

### Phase 5.6 — Private Mode & Guest Mode

1. `private?: boolean` on `PersonSchema` (default false). Lock icon toggle in Identity Panel.
2. API middleware: filter `private: true` from list/search when unauthenticated. Return 404 (not 403) for direct access.
3. Frontend: private persons hidden in guest mode. Witness events show "Private Individual".

### Phase 5.7 — Command Palette Commands

1. Static `COMMANDS` array in CommandPalette (Create Person, Import/Export GEDCOM, Switch Theme, Create Snapshot, Force Rebuild, View Map, View Assets).
2. Render as 4th `CommandGroup`, wire actions.

### Phase 5.8 — Git History & Recovery

**Backend:**
1. Semantic commit messages via `OperationHint` in `TransactionManager` (create/update/delete person, upload/delete media, import, story CRUD).
2. `getPendingLabels()`, `setBatchHint()`, `flush(messageOverride)` on TransactionManager.
3. `GET /api/system/git-status` (enhanced: branch, dirty, pendingFiles, lastCommit).
4. `POST /api/system/commit` (flush with optional message).
5. `GET /api/system/git-log` + `GET /api/system/git-log/:hash` (paginated history + commit detail).
6. `GET /api/system/snapshots` + `DELETE /api/system/snapshots/:name`.
7. `POST /api/system/restore` (full-repo or single-person scope).
8. `GET /api/people/:id/history` (path-filtered commit log).
9. Extend `GET /system/status` with heap metrics + hydration duration.

**Frontend:**
10. `useGitStatus()` (adaptive polling), `useGitLog()`, `useGitCommitDetail()`, `useSnapshots()`, `usePersonHistory()`, mutation hooks.
11. Settings page: 4 sections (System Status, Git Status + Commit Now, History Log, Snapshots).
12. `RestoreDialog` component (full-repo + single-person scopes).
13. `PersonHistoryTab` as 4th tab in Person Detail Context Panel.
14. Sidebar dirty indicator (branch name + amber dot).

### Phase 6 — Distribution & Deployment

1. Docker multi-stage build (frontend + backend).
2. Electron desktop wrapper.
3. CI/CD GitHub Action (Vitest + Playwright on PRs).
4. "Living Surname" anonymization (requires Phase 5.6).
5. GEDCOM Export UI (Command Palette trigger).
