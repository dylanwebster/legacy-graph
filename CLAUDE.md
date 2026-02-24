# LegacyGraph — Developer Guide

Self-hosted genealogy platform. File-system-first, Git-versioned, in-memory graph runtime. See `SPECIFICATION.md` for the full technical specification and `PROGRESS.md` for implementation status.

---

## Commands

### Backend
```bash
npm test          # Run all Vitest tests (204 passing, 0 skipped)
npm run build     # tsc --noEmit (type-check only)
npm start         # tsx --env-file=.env src/index.ts
```

### Frontend
```bash
cd client
npm run dev       # Vite dev server (proxies /api → localhost:3000)
npm run build     # Production build → client/dist/
```

### Kill Stale Backend Server
```bash
lsof -ti :3000 | xargs kill
```

---

## Rules

- Always use Context7 MCP when I need public library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

---

## Architecture

**Dual-Head Pattern**:
- **Head 1 (Persistence)**: Local file system — `people/*.yaml`, `stories/*.md`, `assets/*`, `_meta/*.yaml`. Human-readable. `.git` is the undo button.
- **Head 2 (Runtime)**: Node.js (Fastify) + Graphology in-memory directed multigraph. Nuclear hydration on boot, hot-patching via `@parcel/watcher`.

**Boot sequence**: Worker thread (`HydrationWorker.ts`) reads YAML, checks tiered binary cache (`_meta/.graph-cache.json`), validates with Zod, hands data to main thread. Main thread builds Graphology graph, computes `_computed` relationships, builds FlexSearch index (or loads persisted `_meta/.search-index.json`). Server is immediately available (returns 503 for data endpoints until hydration completes).

---

## Project Structure

```
src/
  core/
    BootLoader.ts          # YAML parsing + Zod validation
    GraphEngine.ts         # Graphology multigraph, hydration, hot-patch, watcher
    GraphCache.ts          # Tiered binary cache (mtime-based incremental boot)
    GraphLogic.ts          # computeRelationships(), Henry VIII spouse algorithm, getSiblings()
    HydrationWorker.ts     # worker_threads entry point for background hydration
    SearchService.ts       # FlexSearch for people, stories, places
    StoryLoader.ts         # Markdown + @mention / [[wikilink]] extraction
    TimelineSlicer.ts      # Merged event+story timeline with gap detection
    TransactionManager.ts  # Debounced git commits (5s window) via isomorphic-git
    Thumbnailer.ts         # Sharp → WebP thumbnails
    gedcom/
      Import.ts            # GEDCOM 5.5.1/7.0 → YAML
      Export.ts            # YAML → GEDCOM 5.5.1
  api/
    routes/
      people.ts            # CRUD + media upload
      search.ts            # FlexSearch-powered search
      system.ts            # Status, rebuild, snapshot, SSE hydration stream
      auth.ts              # Login/logout (BCrypt + JWT HttpOnly cookie)
      gedcom.ts            # Bulk GEDCOM import
    middleware/auth.ts     # JWT auth guard (optional — skipped if auth.yaml absent)
    types.ts               # AppServices interface, AppInstance type
  schemas/                 # Zod schemas: Person, Event, Story, Asset, Auth
  utils/dateParser.ts      # Shared GEDCOM date parsing
  server.ts                # Fastify setup + plugin registration (~95 lines)
  index.ts                 # Bootstrap entry point

tests/
  api/       Server, Auth, HydrationStream, MediaDelivery
  core/      BootLoader, GraphEngine, GraphCache, GraphLogic, HotPatch,
             HydrationWorker, SearchService, SearchPersistence, SlimNode,
             StoryLoader, Thumbnailer, TimelineSlicer, TransactionManager,
             Watcher, WriteDedup, gedcom/Import|Export|RoundTrip|Robustness
  schemas/   PersonSchema, EventSchema, StorySchema, AssetSchema,
             AuthSchema, SchemaExpansion
  utils/     DateParser
  fixtures/data/           # Test data directory (git-initialized in beforeEach)

client/src/
  api/           client.ts, hooks.ts (TanStack Query), people.ts (types)
  components/    Sidebar, TopBar, CommandPalette, HydrationProgress,
                 CustomAvatar, StatusDot, ErrorFallback, GlobalNotFound
                 ui/ (shadcn/ui: Button, Dialog, Command, Tabs, Resizable, etc.)
  routes/        __root.tsx, index.lazy.tsx, people/index.lazy.tsx,
                 people/$id.lazy.tsx, import.lazy.tsx, settings.lazy.tsx,
                 search.lazy.tsx
  store/         uiStore.ts (Zustand)
```

---

## Core Principles

1. **TDD is mandatory** — write a failing test before writing implementation code.
2. **Spec-first** — `SPECIFICATION.md` is authoritative. Discrepancies between spec and code are critical bugs.
3. **Slim Nodes** — `scrapbook_md` and `_gedcom` are stripped from the in-memory graph. Lazy-loaded from disk on `GET /people/:id`. This keeps ~100MB+ of idle text out of the V8 heap at 50K nodes.
4. **Self-write dedup** — API writes register the file path in a write-origin set (`GraphEngine`). The file watcher skips hot-patching for self-written files. External edits (VS Code, `git checkout`) pass through normally.
5. **Debounced commits** — `TransactionManager` batches writes into a single `isomorphic-git` commit every 5 seconds. No child processes for git.

---

## Data Model

### Person file: `people/[id].yaml`
Schema version: `"5.0"`. Key fields: `id` (human-readable: `N_[first]-[last]-[birthyear]-[place]-[nanoid8]`), `version`, `names[]`, `sex` (M/F/I/U), `tags[]`, `relationships.parents[]` (upstream only — the only stored relationships), `events[]`, `assets[]`, `scrapbook_md` (stripped from memory), `_gedcom` (stripped from memory).

### Computed relationships (`_computed` — volatile, never persisted)
```typescript
_computed: {
  currentSpouse: { id: string; status: "married" | "widowed" } | null;
  siblings: string[];
  children: string[];
  allSpouses: Array<{ id: string; status: string; sortDate: string }>;
}
```
Populated during hydration. Invalidated for a node + all immediate neighbors on every hot-patch or API write.

### Events (discriminated union, 11 types)
`birth`, `death`, `marriage` (has `partner_id`, `status`), `divorce` (has `partner_id`), `residence`, `census`, `occupation`, `education`, `baptism`, `burial`, `generic`.

Spouse logic uses the **Henry VIII Algorithm**: replay marriage/divorce events sorted by `sort_date` to derive `currentSpouse`. Widowed status checked via partner's `death` events.

### Graph edges
- `child_of`: Person → Parent (from `relationships.parents`)
- `mentions`: Story → Person (from `@N_xxx` / `[[N_xxx]]` in Markdown)

---

## API Endpoints

Base URL: `/api`. Auth: JWT in HttpOnly cookie. Auth is optional — if `/_meta/auth.yaml` is absent, all routes are public.

**Always available** (no auth, no 503 gate): `GET /system/status`, `GET /system/hydration/stream`, `POST /auth/login`, `POST /auth/logout`.

**503 during hydration**: All other endpoints return `{ error: "Graph is loading", code: "HYDRATION_IN_PROGRESS" }` until hydration completes.

| Method | Path | Notes |
|:-------|:-----|:------|
| GET | `/people` | `?limit=50&offset=0&sort=last_modified&order=desc` → `{ people: SlimPersonSummary[], totalCount }` |
| GET | `/people/:id` | `?timeline_limit=50&timeline_offset=0` — lazy-loads `scrapbook_md` + `_gedcom` from disk |
| POST | `/people` | Create → writes YAML, runs `applyWriteSideEffects()` |
| PUT | `/people/:id` | Update → diffs edges, runs `applyWriteSideEffects()` |
| PUT | `/people/:id/media` | Multipart upload → `/assets/`, updates YAML |
| DELETE | `/people/:id/media/:filename` | Delete asset — removes file from disk + YAML |
| GET | `/assets/*` | Static delivery with HTTP Range + immutable cache headers |
| GET | `/search` | `?q=&limit=50&offset=0` → `{ people, stories, places, totalCounts }` |
| GET | `/stats` | Dashboard stats (total people, families, last modified) |
| GET | `/system/status` | `{ nodeCount, edgeCount, hydrationState, cacheAge }` |
| GET | `/system/hydration/stream` | SSE — `progress` events during loading, `complete` when done |
| POST | `/system/rebuild` | Force full nuclear hydration (bypasses caches) |
| POST | `/system/snapshot` | Flush pending commits + create git tag |
| POST | `/import/gedcom` | Destructive bulk import (wipes `people/*.yaml`) |
| POST | `/auth/login` | BCrypt validate → JWT HttpOnly cookie |
| POST | `/auth/logout` | Clear cookie |

---

## Key Technical Decisions

- **`isomorphic-git`** — all git operations run in-process. No `simple-git`, no child-process spawning.
- **`@parcel/watcher`** — native OS file watching (inotify on Linux). Replaced `chokidar`. No EMFILE limits.
- **Worker threads** — hydration runs in a background worker. Main thread stays responsive immediately.
- **`p-limit`** — concurrency cap during YAML parsing in `BootLoader`.
- **`tsx/cjs`** — `execArgv` require hook in `HydrationWorker` to handle ESM-only packages (`p-limit`, `remark`) in CommonJS worker context.
- **`bcryptjs`** — pure JS password hashing (no native compilation).
- **Auth is optional** — graceful degradation when `/_meta/auth.yaml` is missing.
- **Pagination mandatory** — search and timeline endpoints enforce `limit`/`offset`. Max `limit` = 200 for search.
- **File watcher circuit breaker** — >50 events in 500ms triggers full background re-hydration (handles `git checkout` / bulk edits).

---

## Frontend Stack

- **Framework**: React 19 + Vite 7 + TypeScript
- **Routing**: TanStack Router (file-based, `client/src/routes/`)
- **Data**: TanStack Query — all mutations use optimistic updates (`onMutate` → cache update, `onError` → rollback)
- **UI state**: Zustand (`client/src/store/uiStore.ts`) — sidebar, modals, active panels
- **Components**: shadcn/ui (Radix + Tailwind v4)
- **Icons**: Lucide React
- **Toasts**: Sonner
- **Virtualization**: `@tanstack/react-virtual` — mandatory for Timeline Feed, People table, Search results
- **Resizable panels**: `react-resizable-panels` — Holy Grail 3-column layout
- **Dev proxy**: `/api` → `http://localhost:3000` (configured in `client/vite.config.ts`)

### Responsive breakpoints
- `≥1280px`: Full sidebar with labels
- `768–1279px`: Icon-only sidebar
- `<768px`: Hamburger overlay; Holy Grail panels stack vertically

---

## Implementation Status

**Backend (Phases 1–3.10): Complete.** 204 tests, all passing.

**Frontend (Phase 4): Substantially complete.** App shell, Command Palette, People Browse, Holy Grail Person Detail, Event/Relationship editors, Import, Settings, Search, Dashboard (stats), and E2E tests are all built.

**Remaining work — in-progress features (Phase 3.11+):**
- `3.11` — Human-readable IDs: `N_[first]-[last]-[birthyear]-[place]-[nanoid8]`; auto-ID + rename for dropped files without `id`
- `3.12` — GEDCOM import is broken — investigate and fix
- `3.13` — Fuzzy date parsing audit: ensure `1920→1920-01-01`, `Bet. 1900 and 1910→1905-06-01`, `Bef. 1850→1849-12-31` are correct
- `3.14` — Asset deletion: `DELETE /people/:id/media/:filename` — delete from disk + YAML
- `3.15` — Place/geo-tagging: structured `{ name, lat, lng, countryCode, historicalName }` + Nominatim geocoding; new `GET /api/places/search` endpoint
- `4.9` — Force graph visualization (`react-force-graph-2d`) on Dashboard not built
- `4.11` — Frontend date validation: block dialog submit when date cannot be parsed
- `4.12` — Notebook markdown rendering: use `react-markdown` in view mode
- `4.13` — Timeline "Unknown Date" section: undated events at top, not bottom
- `4.14` — Sibling management in `RelationshipEditorDialog` (new Siblings tab)
- `4.15` — Asset deletion confirmation dialog (frontend for Phase 3.14)
- `5.1` — Tiptap rich story editor
- `5.2` — 3D time tunnel (`react-three-fiber`)
- `5.3` — Heap monitoring in `/system/status`
- `6` — Docker, Electron, CI/CD
