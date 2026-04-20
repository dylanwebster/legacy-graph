# LegacyGraph — Developer Guide

Self-hosted genealogy platform. File-system-first, Git-versioned, in-memory graph runtime.

- `SPECIFICATION.md` — full technical spec (authoritative)
- `PROGRESS.md` — implementation status and remaining work

---

## Commands

```bash
# Testing
npm test              # Vitest (excludes tests/e2e)
npm run test:e2e      # Playwright (stop dev backend first — e2e starts its own on :3000)

# Backend
npm run build         # tsc --noEmit (type-check only)
npm run lint          # ESLint
npm start             # tsx --env-file=.env src/index.ts

# Frontend
cd client
npm run dev           # Vite dev server (proxies /api → localhost:3000)
npm run build         # Production build → client/dist/
npm run lint          # Frontend lint

# GeoNames DB (offline geocoding)
npm run geonames:build    # Downloads ~580 MB, builds ~/.legacy-graph/geonames.db (~900 MB)

# Synthetic data
npm run generate:synthetic-data

# Kill stale backend
lsof -ti :3000 | xargs kill
```

---

## Rules

1. **TDD is mandatory** — write a failing test before implementation code.
2. **Spec-first** — `SPECIFICATION.md` is authoritative. Spec/code discrepancies are critical bugs.
3. **Track progress** — update `PROGRESS.md` after completing or starting work.
4. **Use playwright-cli skill** for e2e test development.
5. **Pre-PR checks** — all must pass with zero errors: `npm test`, `npm run test:e2e`, `npm run lint`, `cd client && npm run lint`.
6. **No flakey tests** - if you find that a test is flakey, even if it is unrelated to current changes, do not tolerate this. Find the root cause of all flakey tests.

---

## Architecture

**Dual-Head Pattern:**
- **Persistence**: File system — `people/*.yaml`, `stories/*.md`, `assets/*`, `_meta/*.yaml`. Git-versioned.
- **Runtime**: Fastify + Graphology in-memory multigraph. Worker thread hydration on boot, hot-patching via `@parcel/watcher`. 503 during hydration.

**Key backend modules** (`src/core/`): `GraphEngine` (graph + hydration + watcher), `BootLoader` (YAML parse + Zod validate), `GraphLogic` (computed relationships), `SearchService` (FlexSearch), `TimelineSlicer`, `TransactionManager` (debounced git commits via isomorphic-git), `GeocodingService` + `GeonamesDb` (forward + reverse geocoding).

**Frontend stack**: React 19, Vite 7, TypeScript 6, TanStack Router + Query, Zustand, shadcn/ui (Radix + Tailwind v4), Lucide icons, Sonner toasts, `@tanstack/react-virtual`, `react-resizable-panels`, `react-force-graph-2d`, Milkdown Crepe (WYSIWYG editor).

---

## Data Model

**Person** (`people/[id].yaml`): Schema `"5.0"`. ID format: `N_[first]-[last]-[birthyear]-[place]-[nanoid8]`. Only `relationships.parents[]` is stored — spouses, children, siblings are computed at runtime (`_computed`).

**Events**: 16 types (`birth`, `death`, `marriage`, `divorce`, `engagement`, `residence`, `census`, `occupation`, `education`, `military_service`, `immigration`, `emigration`, `adoption`, `baptism`, `burial`, `generic`). All support `witness_ids[]` and `location` (Place object or bare string, auto-coerced). Spouse logic: Henry VIII Algorithm (replay marriage/divorce events by sort_date).

**Stories** (`stories/*.md`): Markdown with YAML frontmatter. `@N_xxx` mentions create graph edges.

**Assets**: Single source of truth is `person.assets[]`. No `tagged_people` in asset metadata.

**Graph edges**: `child_of` (Person → Parent), `mentions` (Story → Person).

---

## Project Structure

```
src/
  core/          GraphEngine, BootLoader, GraphLogic, SearchService,
                 TimelineSlicer, TransactionManager, GeocodingService,
                 GeonamesDb, Thumbnailer, StoryLoader, gedcom/
  api/routes/    people, stories, assets, search, system, auth, gedcom
  schemas/       PersonSchema, EventSchema, StorySchema, AssetSchema,
                 PlaceSchema, AuthSchema
  server.ts      Fastify setup (~95 lines)

tests/
  api/           Server, Auth, HydrationStream, MediaDelivery, Stories
  core/          All core modules + gedcom/
  schemas/       All schemas
  e2e/           Playwright CUJ tests

client/src/
  routes/        TanStack file-based. Thin route files that re-export
                 from features/: index, people/, stories/, assets,
                 search, import, settings. Route-level data loading
                 and layout composition only.
  features/      Feature-scoped pages, components, and state. Pages
                 render into shared PageShell for consistent layout.
    assets/      AssetsPage + components/ (AssetLightbox,
                 AssetPickerDialog, AssetSearchBar, BulkUploadDialog)
    dashboard/   FamilyGraphPanel/ (force graph), FanChartPanel,
                 PedigreePanel, pedigreeLayout, dashboardState,
                 useDashboardState
    people/      PeopleListPage, PersonDetailPage, eventTypeConfig,
                 components/ (CreatePersonDialog, EventEditorDialog,
                 RelationshipEditorDialog, RelationshipSection,
                 AvatarCropDialog, PersonTimeline)
    search/      SearchPage, CommandPalette
    settings/    SettingsPage, BatchGeocodePanel, geocodeStore
    stories/     StoriesListPage, StoryDetailPage
  shared/        Cross-feature primitives (no feature dependencies).
    api/         client, hooks, people/stories type modules
    components/  Reusable components: PersonChip, PersonHoverCard,
                 PersonPreviewCard, PersonSearchCombobox,
                 PlaceSearchCombobox, SearchBar, CustomAvatar,
                 HydrationProgress, ErrorFallback, GlobalNotFound,
                 StatusDot, MilkdownEditor/, SmartDateInput, and
                 layout/ (Sidebar, TopBar, PageShell, TopBarSlotContext)
    lib/         assets, avatarCrop, cn, names, places, sexColors
    store/       uiStore (Zustand, app-wide UI state)
    ui/          shadcn/ui primitives (button, dialog, input, …)
```

---

## GeoNames Database

Offline SQLite DB for place search and reverse geocoding. Built via `npm run geonames:build`.

- `GeonamesDb` — FTS5 forward search + spatial index reverse geocoding
- `GeocodingService` — high-level service with in-memory + disk cache (`_meta/.geocode-cache.json`)
- Asset uploads auto-reverse-geocode EXIF GPS via `reverseGeocodeExifGps()` in `src/core/assetMetaUtils.ts`
- DB path: `GEONAMES_DB` env var or `~/.legacy-graph/geonames.db`. Gracefully degrades if missing.
- Schema version `2.1` tracked in `db_meta.version`. Rebuild after schema changes.
