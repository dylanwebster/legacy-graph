# LegacyGraph — Developer Guide

Self-hosted genealogy platform. File-system-first, Git-versioned, in-memory graph runtime. See `SPECIFICATION.md` for the full technical specification and `PROGRESS.md` for implementation status.

---

## Commands

### Backend
```bash
npm test          # Run all Vitest tests (232 passing, 0 skipped)
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

### Synthetic Test Data
```bash
# Generate 200 people across 5 generations into ./data (default)
npm run generate:synthetic-data

# Custom output directory, count, and seed
npx tsx scripts/generateSyntheticData.ts --output ./my-data --count 500 --generations 6 --seed 99

# Append without wiping existing synthetic files
npx tsx scripts/generateSyntheticData.ts --keep-existing

# Clean up all synthetic files manually (safe — only removes N_SYN_* people and synthetic-family-*.md stories)
find ./data/people -name 'N_SYN_*.yaml' -delete
find ./data/stories -name 'synthetic-family-*.md' -delete
```

**Notes:**
- Synthetic IDs use the format `N_SYN_00001` (not the production `N_[first]-[last]-[year]-[nanoid8]` format). The `N_SYN_` prefix is intentional — it's what `--clean-synthetic` (default) uses to identify and delete only generated files.
- Generated files are tagged `synthetic` and `generation-N` for easy filtering.

---

## Rules

You must always abide by these rules:
- Always use Context7 MCP when I need public library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.
- Always use the frontend-design skill when doing frontend design work.

---

## Architecture

**Dual-Head Pattern**:
- **Head 1 (Persistence)**: Local file system — `people/*.yaml`, `stories/*.md`, `assets/*`, `_meta/*.yaml`. Human-readable. `.git` is the undo button.
- **Head 2 (Runtime)**: Node.js (Fastify) + Graphology in-memory directed multigraph. Nuclear hydration on boot, hot-patching via `@parcel/watcher`.

**Boot sequence**: Worker thread hydrates from YAML (tiered binary cache → incremental parse → Zod validation) → main thread builds Graphology graph + `_computed` relationships + FlexSearch index. Server returns 503 on data endpoints until hydration completes.

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
    TimelineSlicer.ts      # Merged event+story+witness timeline with gap detection
    TransactionManager.ts  # Debounced git commits (5s window) via isomorphic-git
    Thumbnailer.ts         # Sharp → WebP thumbnails
    GeocodingService.ts    # Nominatim geocoding, cache, rate limiter (Phase 3.15)
    gedcom/
      Import.ts            # GEDCOM 5.5.1/7.0 → YAML
      Export.ts            # YAML → GEDCOM 5.5.1
  api/
    routes/
      people.ts            # CRUD + media upload
      stories.ts           # Story CRUD + media (Phase 5.1)
      search.ts            # FlexSearch-powered search + places type-ahead
      assets.ts            # Asset gallery listing + orphan detection (Phase 5.4)
      system.ts            # Status, rebuild, snapshot, SSE hydration stream, git-status
      auth.ts              # Login/logout (BCrypt + JWT HttpOnly cookie)
      gedcom.ts            # Bulk GEDCOM import
    middleware/auth.ts     # JWT auth guard (optional — skipped if auth.yaml absent)
    types.ts               # AppServices interface, AppInstance type
  schemas/                 # Zod schemas: Person, Event, Story, Asset, Auth
  utils/dateParser.ts      # Shared GEDCOM date parsing
  server.ts                # Fastify setup + plugin registration (~95 lines)
  index.ts                 # Bootstrap entry point

tests/
  api/       Server, Auth, HydrationStream, MediaDelivery, Stories (Phase 5.1)
  core/      BootLoader, GraphEngine, GraphCache, GraphLogic, HotPatch,
             HydrationWorker, SearchService, SearchPersistence, SlimNode,
             StoryLoader, Thumbnailer, TimelineSlicer, TransactionManager,
             Watcher, WriteDedup, GeocodingService (Phase 3.15),
             gedcom/Import|Export|RoundTrip|Robustness
  schemas/   PersonSchema, EventSchema, StorySchema, AssetSchema,
             AuthSchema, SchemaExpansion
  utils/     DateParser
  fixtures/data/           # Test data directory (git-initialized in beforeEach)

client/src/
  api/           client.ts, hooks.ts (TanStack Query), people.ts, stories.ts (types)
  components/    Sidebar, TopBar, CommandPalette, HydrationProgress,
                 CustomAvatar, StatusDot, ErrorFallback, GlobalNotFound,
                 WitnessEventCard, StoryFeedCard (Phase 5.1)
                 ui/ (shadcn/ui: Button, Dialog, Command, Tabs, Resizable, etc.)
  routes/        __root.tsx, index.lazy.tsx,
                 people/index.lazy.tsx, people/$id.lazy.tsx,
                 stories/index.lazy.tsx, stories/$id.lazy.tsx,
                 map.lazy.tsx, assets.lazy.tsx,
                 import.lazy.tsx, settings.lazy.tsx, search.lazy.tsx
  store/         uiStore.ts (Zustand)
```

---

## Core Principles

1. **TDD is mandatory** — write a failing test before writing implementation code.
2. **Spec-first** — `SPECIFICATION.md` is authoritative. Discrepancies between spec and code are critical bugs.
3. **Keep track of full progress** — `PROGRESS.md` must be updated with the full implementation progress and remaining steps.
4. **Slim Nodes** — `scrapbook_md` and `_gedcom` are stripped from the in-memory graph. Lazy-loaded from disk on `GET /people/:id`. This keeps ~100MB+ of idle text out of the V8 heap at 50K nodes.
5. **Self-write dedup** — API writes register the file path in a write-origin set (`GraphEngine`). The file watcher skips hot-patching for self-written files. External edits (VS Code, `git checkout`) pass through normally.
6. **Debounced commits** — `TransactionManager` batches writes into a single `isomorphic-git` commit every 5 seconds. No child processes for git.

---

## Data Model

### Person file: `people/[id].yaml`
Schema version: `"5.0"`. Key fields: `id` (human-readable: `N_[first]-[last]-[birthyear]-[place]-[nanoid8]`), `version`, `names[]`, `sex` (M/F/I/U), `tags[]`, `private` (bool — hides profile in Guest Mode), `relationships.parents[]` (upstream only — the only stored relationships), `events[]`, `assets[]`, `scrapbook_md` (stripped from memory), `_gedcom` (stripped from memory).

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

### Events (discriminated union, 17 types)
`birth`, `death`, `marriage` (has `partner_id`, `status`), `divorce` (has `partner_id`), `engagement` (has `partner_id`), `residence`, `census`, `occupation`, `education`, `graduation`, `military_service`, `emigration`, `adoption`, `baptism`, `burial`, `cremation`, `generic`.

All events support `witness_ids?: string[]` — persons present at the event. Witness events appear on both the subject's and witness's timelines.

Spouse logic uses the **Henry VIII Algorithm**: replay marriage/divorce events sorted by `sort_date` to derive `currentSpouse`. Widowed status checked via partner's `death` events.

### Graph edges
- `child_of`: Person → Parent (from `relationships.parents`)
- `mentions`: Story → Person (from `@N_xxx` / `[[N_xxx]]` in Markdown)

---

## Sidebar Navigation

| Item | Icon | Route | Description |
|:-----|:-----|:------|:------------|
| Dashboard | Tree | `/` | Stats + visualization (Force Graph / Fan Chart / Pedigree) |
| People | Users | `/people` | Searchable table of all people |
| Stories | Book | `/stories` | Blog-feed of all stories |
| Map | Globe | `/map` | Interactive world map of geocoded event locations |
| Assets | Image | `/assets` | Universal asset gallery + orphan detection |
| Import | Upload | `/import` | GEDCOM import with SSE progress |
| Settings | Cog | `/settings` | System status, auth, cache, Git branch/dirty state |

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
| GET | `/stories` | Paginated story list → `{ stories: StoryFeedItem[], totalCount }` (Phase 5.1) |
| GET | `/stories/:id` | Full story — frontmatter + body Markdown (Phase 5.1) |
| POST | `/stories` | Create story Markdown file (Phase 5.1) |
| PUT | `/stories/:id` | Update story (Phase 5.1) |
| DELETE | `/stories/:id` | Delete story (Phase 5.1) |
| PUT | `/stories/:id/media` | Attach asset to story (Phase 5.1) |
| GET | `/assets` | List all `/assets` files with referencing people/stories (Phase 5.4) |
| GET | `/assets/*` | Static delivery with HTTP Range + immutable cache headers |
| GET | `/search` | `?q=&limit=50&offset=0` → `{ people, stories, places, totalCounts }` |
| GET | `/places/search` | `?q=` → top 5 geocoded Place candidates (Phase 3.15) |
| POST | `/places/resolve` | `{ name }` → resolved Place object (Phase 3.15) |
| GET | `/stats` | Dashboard stats (total people, families, last modified) |
| GET | `/system/status` | `{ nodeCount, edgeCount, hydrationState, cacheAge, gitBranch, gitDirty }` |
| GET | `/system/hydration/stream` | SSE — `progress` events during loading, `complete` when done |
| GET | `/system/git-status` | `{ branch, dirty, lastCommit: { message, timestamp } }` (Phase 5.10) |
| POST | `/system/rebuild` | Force full nuclear hydration (bypasses caches) |
| POST | `/system/snapshot` | Flush pending commits + create git tag |
| POST | `/import/gedcom` | Bulk import (replace or additive mode) |
| POST | `/auth/login` | BCrypt validate → JWT HttpOnly cookie |
| POST | `/auth/logout` | Clear cookie |

---

## Frontend Stack

- **Framework**: React 19 + Vite 7 + TypeScript
- **Routing**: TanStack Router (file-based, `client/src/routes/`)
- **Data**: TanStack Query — all mutations use optimistic updates (`onMutate` → cache update, `onError` → rollback)
- **UI state**: Zustand (`client/src/store/uiStore.ts`) — sidebar, modals, active panels, dashboard viz mode
- **Components**: shadcn/ui (Radix + Tailwind v4)
- **Icons**: Lucide React
- **Toasts**: Sonner
- **Virtualization**: `@tanstack/react-virtual` — mandatory for Timeline Feed, People table, Stories feed, Search results, Asset gallery
- **Resizable panels**: `react-resizable-panels` — Holy Grail 3-column layout
- **Map**: `react-leaflet` + OpenStreetMap tiles (Phase 5.3)
- **3D**: `three` + `@react-three/fiber` — Fly-Through Timeline (Phase 5.2)
- **Graph viz**: `react-force-graph-2d` — Force Graph (Phase 4.9); D3 for Fan Chart + Pedigree (Phase 5.5)
- **Dev proxy**: `/api` → `http://localhost:3000` (configured in `client/vite.config.ts`)
