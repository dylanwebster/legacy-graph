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

Plan: MapLibre GL + deck.gl overlay + **bundled offline Natural Earth GeoJSON basemap** (no third-party CDN at runtime), with zoom-driven crossfade between a heatmap glow, individual pins, and a focal-person path. Bottom-docked dual-handle time window drives step-wise playback. Scope control (Everyone / Focal person / Focal lineage) shares `useFocalStore` with the Graph page. See `SPECIFICATION.md` §6.11 for the authoritative spec.

#### Sub-phase 5.2.0–5.2.12 — Initial implementation (complete, with caveats)

- [x] **5.2.0** — Schema 5.1 (event date ranges) — `end_date` / `sort_end_date`, auto-migrate from `"5.0"`, GEDCOM `BET…AND` / `FROM…TO` preserved as ranges, EventEditor range toggle.
- [x] **5.2.1** — Shared focal person Zustand store (`useFocalStore`; `rootPersonId` lifted out of `dashboardState`; one-time migration from legacy localStorage blob).
- [x] **5.2.2** — `GraphLogic.getLineage()` + `GET /api/map/events` with `?person=` / `?lineage=` filters. *(Backend route tests added in Phase B.)*
- [x] **5.2.4** — `/map` route scaffolding: MapLibre + deck.gl `MapboxOverlay` + Sidebar Globe icon; day/night styles keyed to `useUIStore.theme`.
- [x] **5.2.5** — Zoom-crossfaded render layers: `HeatmapLayer` + `ScatterplotLayer` with deterministic jitter.
- [ ] **5.2.6a** — Time slider (single-handle, granularity, speed, loop, step-wise playback, keyboard, "Show undated") *(complete)*.
- [ ] **5.2.6b** — Dual-handle time slider (Phase C, replaces 5.2.6a's single-handle).
- [x] **5.2.7** — Scope filter + focal integration with `map.fitBounds`.
- [x] **5.2.8** — Connected-path `PathLayer` for `focal` scope.
- [x] **5.2.9** — Event drawer (desktop side / mobile bottom sheet).
- [x] **5.2.10** — Deep-link contract round-trips except `?event=<id>` (Phase C wires it).
- [x] **5.2.11** — Mobile responsive layout (drawer height + swipe handle finalised in Phase C).
- [x] **5.2.12** — Command palette: "View Map" + "Show focal lineage on Map".

#### Sub-phase 5.2.3 — Basemap (REVISED — offline-first Natural Earth GeoJSON)

The previous PMTiles direction (`5.2.3-old`) and the demotiles fallback were both rejected. PMTiles is overkill for the country/state/city zoom range we want, and `demotiles.maplibre.org` violates the "self-hosted, offline by default" hard constraint. The shipped basemap uses Natural Earth GeoJSON inside the SPA bundle, rendered directly by MapLibre — no tile server, no third-party CDN, no end-user build step.

- [x] **5.2.3** — Bundled offline Natural Earth basemap (Phase A). *Shipped in commit `3058715`.* See "Phase A — what actually shipped" below for the divergence from the original Phase A spec (1:10m countries instead of 1:50m, lakes added, per-feature visibility gating, etc.).

#### Remaining work

- [x] **5.2.13** — Phase A0 fast-fixes: rename `useMapLayers.ts` → `buildMapLayers.ts`, `setStyle({diff:true})`, granularity-aware `initWindowForExtent` + `extentSeeded`, `?event=` opens-once-on-mount semantics, `themedStyle` factory, `eventTypes.ts` registry, `BASEMAP_MAX_ZOOM` constant. *Shipped in commit `c1d406f`.*
- [ ] **5.2.14** — Performance: stable layer accessors + `updateTriggers`, `fitBounds` re-trigger fix, `extentSeeded` flag, slider scrub rAF batching, `pointerup` window listener, server-side `forEachNode` cache + invalidation. (Phase B; **B1 pre-bucketing dropped — overengineered for current scale**. `extentSeeded` already shipped in A0.3.)
- [ ] **5.2.15** — Event-type filter UI (wire `prefsStore.eventTypes`) + collapsible `MapLegend` keyed by `TYPE_COLORS`. (Phase C)
- [ ] **5.2.16** — Dual-handle range slider via `@radix-ui/react-slider` range mode. (Phase C)
- [ ] **5.2.17** — Empty-state and loading-state overlays; PathLayer 3 px stroke + 5 px halo. (Phase C)
- [ ] **5.2.18** — Wire `?event=<id>` deep link to auto-open the EventDrawer. (Phase C)
- [ ] **5.2.19** — Mobile drawer: 40 vh bottom sheet (was 50 vh) + drag-down swipe handle. (Phase C)
- [ ] **5.2.20** — Heatmap zoom-interpolated `radiusPixels` (30 → 60 px). (Phase C)
- [ ] **5.2.21** — URL hygiene: omit `t`/`t_end` when window equals extent; write `?event=` synchronously on drawer open/close. (Phase C)
- [ ] **5.2.22** — Branch hygiene: squash three abandoned PMTiles commits, fold `MAP_VIEW.md` into `SPECIFICATION.md §6.11`. (Phase D)
- [ ] **5.2.23** — Test coverage: `tests/api/MapEvents.test.ts`, `client/src/features/map/layers/buildMapLayers.test.ts`, `client/src/features/map/timeStore.test.ts`. (Phases B–C, ahead of each implementation step.) *`styles.test.ts` shipped in A6 with 9 contract tests.*
- [ ] **5.2.24** — E2E test for the Map View (Phase D). *Visual-regression harness already shipped in commit `27835ad` (5 locations × light/dark = 10 baselines via `npm run test:visual`); Phase D adds Playwright user-flow E2E for pin click, drawer open/close, scope switch, etc.*

---

### Phase A — what actually shipped (vs. original spec)

The shipped Phase A diverges from the original A1–A9 plan in several material ways. Future maintainers should read this section before re-running the build script or modifying the style.

**Data sources (`scripts/buildBasemap.ts`):**

| Layer | Original plan | Shipped |
|---|---|---|
| `countries` | NE 1:50m, simplify 5%, fields `NAME, ISO_A2` | NE **1:10m**, simplify 30%, fields `NAME, ISO_A2`. *Reason: 1:50m at 5% retention rendered Hawaii as 6-vertex polygons and the Canadian Arctic as cartoon shapes. 30% retention preserves fjord coastlines.* |
| `country-labels` | (didn't exist — country labels read from polygon source via `LABEL_X`/`LABEL_Y`) | NEW separate point source; derived from `admin0` via mapshaper `-points inner` (pole-of-inaccessibility). Keeps `NAME` + `MIN_LABEL`. *Reason: rendering one symbol per polygon produced ~20 "Canada" labels for the Arctic Archipelago. Pole of inaccessibility is visually centered, guaranteed inside the polygon.* |
| `states` | NE 1:50m polygons, simplify 5% | NE **1:50m** lines (`ne_50m_admin_1_states_provinces_lines.zip`), simplify 15%, no fields. *Reason: polygon perimeters traced the same coastline as `countries`, producing visible double-trace ghost borders at every coast (Vancouver Island, Hawaii). The lines variant contains interior borders only.* |
| `state-labels` | (didn't exist — state labels read from polygon source) | NEW separate point source; derived from NE **1:10m** `admin1_polys` via `-points inner`. Keeps `name` + `min_zoom`. *Reason: same as country-labels.* |
| `lakes` | (not in original plan) | NEW. NE 1:50m lakes, simplify 50%. Rendered with `background` color so they appear as cutouts in the country fill. *Reason: Canada/US border without Great Lakes looked wrong.* |
| `places` | NE 1:50m **simple** (~243 cities) | NE **1:10m** simple (~7,300 cities). *Reason: 1:50m didn't include any major US metro outside the largest few; San Francisco, Phoenix, Las Vegas etc. weren't there.* |
| `graticules` | NE 1:50m | unchanged. |

**Style factory (`client/src/features/map/styles/themedStyle.ts`):**

- **9 layers** (not the original spec's 7): `background`, `country-fill`, `lake-fill` (added), `country-boundary`, `state-boundary`, `graticules`, `country-label`, `state-label` (added), `city-label`.
- **`country-label` filter**: `MIN_LABEL <= zoom + 2` — major countries clear at zoom 0; tiny territories like Clipperton (`MIN_LABEL ≈ 7-8`) never clear inside our `maxzoom: 5` cap.
- **`state-label` filter**: `min_zoom <= zoom` per feature — large admin_1s (California, Quebec) appear early; tiny ones (Samoan villages, Caribbean parishes) only appear at higher zooms. Combined with `text-allow-overlap: true` + `text-ignore-placement: true` so state names act as watermarks behind cities.
- **`city-label` collision sort**: `symbol-sort-key: ['-', 0, ['to-number', ['get', 'pop_max'], 0]]` — highest population renders first and wins MapLibre's auto-collision dedup. *Reason: `rank_max` ties (SF and Oakland both rank 12) caused the larger city to lose to source order.*
- **State labels** styled as atlas-watermark: uppercase, `text-letter-spacing: 0.18`, muted color, `text-opacity: 0.7`.

**Bundle size**: 6.11 MB raw / 1.53 MB gz (vs. original 30 MB raw / 6 MB gz budget). 256 Open Sans Regular PBFs shipped at 1.4 MB on disk; ~75 KB fetched per Latin-locale session.

**Infrastructure additions:**

- `@fastify/compress` registered globally for transport-time gzip.
- `scripts/buildBasemap.ts` and `scripts/buildBasemapFonts.ts` for one-shot data refresh per NE release.
- `client/public/basemap/*.json` and `client/public/fonts/Open Sans Regular/*.pbf` committed to the repo.
- **Multi-zoom snapshot harness**: `tests/e2e/map-snapshots.spec.ts` + `playwright.config.snapshots.ts`. 10 baselines (5 locations × light/dark). Run via `npm run test:visual`. *macOS-only baselines; Linux-CI baseline generation deferred until a CI workflow exists.*

---

### Map View — Detailed Implementation Plan

The plan is divided into five phases (A0, A, B, C, D) with concrete steps and acceptance criteria. Total estimated effort: **~4 days** (junior dev) / ~2.5 days (senior). Pause for review at each phase boundary.

Conventions used below:
- `[backend]` = Node/TypeScript under `src/`
- `[frontend]` = React/TypeScript under `client/src/`
- `[data]` = files under `client/public/`
- `[scripts]` = build-time only, not shipped to users
- `[tests]` = `tests/` or `client/tests/`
- File paths are absolute from the repo root unless otherwise noted.

> **TDD reminder.** Per `CLAUDE.md` rule 1, every code change starts with a failing test. The plan calls out where tests precede implementation.

---

#### Phase A0 — Fast cleanup before tests are written (~30 min)

These are tiny, independent fixes that should land before any larger change. They keep test files from being written under names that will be renamed, and they fix two latent bugs that would otherwise contaminate Phase B/C verification.

**Step A0.1 — Rename `useMapLayers.ts` → `buildMapLayers.ts`** *([frontend])*

The file exports a pure builder, not a React hook. The `use*` prefix is misleading and trips ESLint's react-hooks rule. Rename and update the single import in `MapView.tsx`.

```bash
git mv client/src/features/map/layers/useMapLayers.ts \
       client/src/features/map/layers/buildMapLayers.ts
```

In `client/src/features/map/MapView.tsx`:

```diff
-import { buildMapLayers } from './layers/useMapLayers';
+import { buildMapLayers } from './layers/buildMapLayers';
```

**Step A0.2 — Fix theme `setStyle` to use `diff: true`** *([frontend])*

In `client/src/features/map/MapView.tsx` line ~96:

```diff
-mapRef.current.setStyle(style, { diff: false });
+mapRef.current.setStyle(style, { diff: true });
```

Day and night styles share layer structure (paint differs only). With `diff: true` MapLibre patches paint properties without re-fetching GeoJSON sources or re-tessellating geometry — required for the spec's "no relayout flash" guarantee.

**Step A0.3 — Granularity-aware `initWindowForExtent` + `extentSeeded`** *([frontend])*

In `client/src/features/map/timeStore.ts`:

1. Add `extentSeeded: boolean` to `TimeState` (default `false`).
2. Replace the legacy `extentStart === 1800 && extentEnd === currentYear` heuristic with the `extentSeeded` gate.
3. Seed an initial window of `[min, min + GRANULARITY_WIDTH[granularity]]`, **not** the full extent. (Otherwise a 200-year extent at the default `decade` granularity yields a 200-year window — a static heatmap.)

```ts
import { useMapPrefsStore } from './prefsStore';

const GRANULARITY_WIDTH = { year: 5, decade: 20, century: 100 } as const;

export function initWindowForExtent(minDate: string | null, maxDate: string | null) {
    if (!minDate || !maxDate) return;
    const min = parseInt(minDate.slice(0, 4), 10);
    const max = parseInt(maxDate.slice(0, 4), 10);
    if (Number.isNaN(min) || Number.isNaN(max)) return;
    const current = useTimeStore.getState();
    current.setExtent(min, max);
    if (!current.extentSeeded) {
        const g = useMapPrefsStore.getState().granularity;
        const width = GRANULARITY_WIDTH[g];
        const start = min;
        const end = Math.min(max, min + width);
        useTimeStore.setState({ windowStart: start, windowEnd: end, extentSeeded: true });
    }
}
```

This step does the *whole* `extentSeeded` migration. **Step B5 is satisfied by this change** — only the unit test in `timeStore.test.ts` remains under B5.

**Step A0.4 — `?event=` opens-once-on-mount semantics** *([frontend])*

This is a contract change captured here so that the Phase C wiring (Step C6) does not introduce the same race twice. Document and enforce: `?event=` is read **once** when both `events.data` first becomes truthy and the URL is parsed; further changes to `search.event` from internal `navigate` calls do not re-open the drawer.

The actual implementation lands in Step C6.

**Step A0.5 — Single themed style factory** *([frontend])*

Mandate **one** factory rather than two hand-maintained `StyleSpecification` builders. `setStyle({ diff: true })` (Step A0.2 / spec §6.11) only patches paint when layer structure matches *exactly* — a missing layer or a re-ordered `layers[]` falls back to a full re-tessellation, breaking the spec's "no relayout flash" guarantee.

Create `client/src/features/map/styles/themedStyle.ts`:

```ts
import type { StyleSpecification } from 'maplibre-gl';

export function themedStyle(theme: 'light' | 'dark'): StyleSpecification {
    // Single source of truth for layer structure. Paint values branch on `theme`.
    // …layer construction here…
    return { version: 8, glyphs: '/fonts/{fontstack}/{range}.pbf', sources: { … }, layers: [ … ] };
}
```

Then collapse the existing builders:

```ts
// day.ts
import { themedStyle } from './themedStyle';
export const dayStyle = () => themedStyle('light');

// night.ts
import { themedStyle } from './themedStyle';
export const nightStyle = () => themedStyle('dark');
```

Step A5's tests must include a layer-shape equality check:

```ts
const day = dayStyle();
const night = nightStyle();
const shape = (s: StyleSpecification) => s.layers.map(l => ({ id: l.id, type: l.type }));
expect(shape(day)).toEqual(shape(night));
```

This is the contract `diff: true` actually depends on.

**Step A0.6 — Extract `eventTypes.ts` registry** *([frontend])*

Today `TYPE_COLORS` and `TYPE_WEIGHTS` live inside `client/src/features/map/layers/useMapLayers.ts`. Phase C will import them into `MapToolbar`, `MapLegend`, and the prefs store — coupling pure UI to the deck.gl layer module.

Create `client/src/features/map/eventTypes.ts`:

```ts
export const EVENT_TYPES = [
    'birth','death','marriage','divorce','engagement','residence',
    'occupation','education','military_service','baptism','burial',
    'immigration','emigration','adoption','census','generic',
] as const;
export type EventType = typeof EVENT_TYPES[number];

export const TYPE_COLORS: Record<EventType, [number, number, number, number]> = { /* moved from useMapLayers */ };
export const TYPE_WEIGHTS: Record<EventType, number> = { /* moved from useMapLayers */ };
```

Update `prefsStore.ts` to narrow `eventTypes: string[] | null` → `EventType[] | null`. Update `buildMapLayers.ts` (after A0.1 rename) to import from this module. Now `MapToolbar`, `MapLegend`, and the layer builder share one registry, and typos like `'Marriage'` vs `'marriage'` become type errors.

**Step A0.7 — Hoist `BASEMAP_MAX_ZOOM` constant** *([frontend])*

Plan A7 changes `maxZoom: 6 → 8` in the `Map` ctor and `fitBounds: 10 → 8`. Hoist to a const so the basemap zoom cap and the fly-to cap can never drift:

```ts
// client/src/features/map/constants.ts
export const BASEMAP_MAX_ZOOM = 8;
```

`MapView.tsx` imports and uses it in both the `maplibregl.Map` ctor and `fitBounds(...)`. Promotes A7's two-string change into a single source of truth from the start.

**Phase A0 acceptance**: `npm test`, `npm run lint`, `cd client && npm run lint`, `npm run build` all pass. No behavioral change yet from A0.4 — it's a contract note carried into Phase C.

---

#### Phase A — Offline Natural Earth basemap (~1.5 days senior / ~3 days junior)

**Goal**: replace the demotiles dependency with bundled GeoJSON files served directly by the SPA. After this phase: opening `/map` with the laptop in airplane mode shows countries, states/provinces, major cities, and graticules with no network requests beyond `localhost`.

**Step A1 — Add the build script entry, no runtime deps** *([scripts])*

Do **not** add `mapshaper` or `shapefile` to `devDependencies`. The script invokes them via `npx mapshaper@<pinned>` and a one-shot `import('shapefile')` after `npm i --no-save shapefile@<pinned>` in the script's preamble. Rationale: these libs are heavy (~30 MB transitive) and only run when refreshing the basemap once per Natural Earth release. The trade-off is a one-time `npx` cold start.

Add to root `package.json`:

```json
"scripts": {
  "basemap:build": "tsx scripts/buildBasemap.ts",
  "basemap:fonts": "tsx scripts/buildBasemapFonts.ts"
}
```

**Step A2 — Write `scripts/buildBasemap.ts`** *([scripts])*

Concrete skeleton (full file — junior should be able to drop this in and iterate):

```ts
// scripts/buildBasemap.ts
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const TMP = path.resolve('.tmp/basemap');
const OUT = path.resolve('client/public/basemap');
const NE = 'https://naciscdn.org/naturalearth/50m';

const LAYERS = [
    {
        name: 'countries',
        zip: `${NE}/cultural/ne_50m_admin_0_countries.zip`,
        shp: 'ne_50m_admin_0_countries',
        simplify: '5%',
        keepFields: ['NAME', 'ISO_A2'],
    },
    {
        name: 'states',
        zip: `${NE}/cultural/ne_50m_admin_1_states_provinces.zip`,
        shp: 'ne_50m_admin_1_states_provinces',
        simplify: '5%',
        keepFields: ['name', 'iso_a2', 'admin'],
    },
    {
        name: 'places',
        zip: `${NE}/cultural/ne_50m_populated_places_simple.zip`,
        shp: 'ne_50m_populated_places_simple',
        simplify: null,
        keepFields: ['name', 'adm0name', 'pop_max', 'rank_max'],
    },
    {
        name: 'graticules',
        zip: `${NE}/physical/ne_50m_graticules_15.zip`,
        shp: 'ne_50m_graticules_15',
        simplify: null,
        keepFields: [],
    },
];

const RAW_BUDGET_MB = 30;
const GZ_BUDGET_MB = 6; // matches §6.11 "~6 MB gzipped"

async function downloadAndUnzip(url: string, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true });
    const zipPath = path.join(destDir, path.basename(url));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    // unzip via system unzip (macOS + linux + bsd ship it; spawnSync keeps deps light)
    const r = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`unzip failed for ${url}`);
}

function mapshaperCmd(layer: typeof LAYERS[number], inDir: string, outFile: string): string[] {
    const inPath = path.join(inDir, `${layer.shp}.shp`);
    const fields = layer.keepFields.length > 0 ? layer.keepFields.join(',') : null;
    const parts = ['-i', inPath];
    if (layer.simplify) parts.push('-simplify', layer.simplify, 'keep-shapes');
    if (fields) parts.push('-filter-fields', fields);
    parts.push('-o', `format=geojson`, `precision=0.0001`, outFile);
    return parts;
}

async function buildLayer(layer: typeof LAYERS[number]): Promise<{ name: string; rawSize: number; gzSize: number }> {
    const layerTmp = path.join(TMP, layer.name);
    await downloadAndUnzip(layer.zip, layerTmp);
    const outFile = path.join(OUT, `${layer.name}.json`);
    const args = mapshaperCmd(layer, layerTmp, outFile);
    const r = spawnSync('npx', ['--yes', 'mapshaper@0.6', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`mapshaper failed for ${layer.name}`);
    const buf = await readFile(outFile);
    const gz = gzipSync(buf, { level: 9 });
    return { name: layer.name, rawSize: buf.length, gzSize: gz.length };
}

async function main(): Promise<void> {
    if (existsSync(TMP)) await rm(TMP, { recursive: true });
    await mkdir(OUT, { recursive: true });
    const reports: Awaited<ReturnType<typeof buildLayer>>[] = [];
    for (const layer of LAYERS) reports.push(await buildLayer(layer));

    const totalRaw = reports.reduce((a, r) => a + r.rawSize, 0);
    const totalGz = reports.reduce((a, r) => a + r.gzSize, 0);
    console.log('\nLayer sizes:');
    for (const r of reports) {
        console.log(`  ${r.name.padEnd(12)} ${(r.rawSize / 1e6).toFixed(2)} MB raw / ${(r.gzSize / 1e6).toFixed(2)} MB gz`);
    }
    console.log(`  TOTAL        ${(totalRaw / 1e6).toFixed(2)} MB raw / ${(totalGz / 1e6).toFixed(2)} MB gz`);

    if (totalRaw > RAW_BUDGET_MB * 1e6) {
        console.error(`Raw size ${(totalRaw / 1e6).toFixed(1)} MB exceeds budget ${RAW_BUDGET_MB} MB`);
        process.exit(1);
    }
    if (totalGz > GZ_BUDGET_MB * 1e6) {
        console.error(`Gzipped size ${(totalGz / 1e6).toFixed(1)} MB exceeds budget ${GZ_BUDGET_MB} MB`);
        process.exit(1);
    }
}

await main();
```

Acceptance: `npm run basemap:build` emits four `.json` files under `client/public/basemap/`. Sizes are logged. Script exits non-zero on threshold violation. **Note: only `.json` files are emitted — gzip happens at HTTP transport time via `@fastify/compress`, see Step A2b.**

**Step A2b — Confirm `@fastify/compress` registration** *([backend])*

Open `src/server.ts` and confirm `@fastify/compress` is registered with default settings (it should already be — verify). If absent, add:

```ts
import compress from '@fastify/compress';
await server.register(compress, { global: true, encodings: ['br', 'gzip'] });
```

For Vite dev (`localhost:5173`), the dev server gzips automatically. For production (`client/dist/` served by Fastify static), the `@fastify/compress` plugin handles `Accept-Encoding`. No `.json.gz` siblings on disk.

**Step A3 — Run the build and commit the output** *([data])*

```bash
npm run basemap:build
git add client/public/basemap/
git commit -m "Add bundled Natural Earth basemap data (NE 1:50m)"
```

The committed files are checked into the repo so end users do not run the build script. `npm run basemap:build` is rerun only when upgrading to a new Natural Earth release.

**Step A4 — Bundle the glyph stack (vendored, no npm dep)** *([data])*

`@openmaptiles/fonts` is **not** published to npm in a form usable here. Vendor the PBFs from the upstream repo instead — no `package.json` entry, no install step.

```ts
// scripts/buildBasemapFonts.ts
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TMP = path.resolve('.tmp/fonts');
const DST = path.resolve('client/public/fonts/Open Sans Regular');
const REPO = 'https://github.com/openmaptiles/fonts.git';

async function main(): Promise<void> {
    if (existsSync(TMP)) await rm(TMP, { recursive: true });
    await mkdir(path.dirname(TMP), { recursive: true });
    const r = spawnSync('git', ['clone', '--depth', '1', REPO, TMP], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`git clone failed: ${REPO}`);
    await mkdir(DST, { recursive: true });
    const r2 = spawnSync('cp', ['-R', `${TMP}/Open Sans Regular/.`, DST], { stdio: 'inherit' });
    if (r2.status !== 0) throw new Error('cp -R failed');
    console.log(`Copied glyph PBFs from ${TMP}/Open Sans Regular to ${DST}`);
}

await main();
```

Wired in via `package.json` script `basemap:fonts` (Step A1). Run once: `npm run basemap:fonts` then `git add client/public/fonts/`. The `git clone` only happens during basemap refresh, never during install.

**Verify before committing**: `ls client/public/fonts/'Open Sans Regular'/` shows ~256 `.pbf` files (one per Unicode range), totaling ~5 MB on disk. MapLibre fetches only the ranges containing rendered text per session (~10–20 KB per page load).

**Step A5 — Failing tests for the new style** *([tests])*

Create `client/src/features/map/styles/styles.test.ts`. The default `client/vitest.config.ts` glob is `**/*.test.ts` so the file is auto-discovered — no config change needed. Verify with `cd client && npx vitest list` (the new file should appear in the listing).

Tests:
1. `dayStyle()` and `nightStyle()` return objects matching MapLibre's `StyleSpecification` shape (`version: 8`, `sources`, `layers`).
2. Both styles declare exactly four sources: `countries`, `states`, `places`, `graticules`, each with `type: 'geojson'` and a relative `data` URL beginning with `/basemap/`.
3. `style.glyphs === '/fonts/{fontstack}/{range}.pbf'`.
4. Both styles include layers with these IDs (in this order): `background`, `country-fill`, `country-boundary`, `state-boundary`, `graticules`, `country-label`, `city-label`.
5. The `state-boundary` and `city-label` layers each have a `minzoom` set (3 and 4 respectively).
6. The `city-label` layer has a `filter` expression of the shape `['<=', ['get', 'rank_max'], <expression>]`.
7. No layer has any `'source-layer'` field (those are tile-source-only — would indicate leftover demotiles config).
8. **Layer-shape parity** (the `setStyle({ diff: true })` contract from A0.5): `dayStyle().layers.map(l => ({ id: l.id, type: l.type }))` deep-equals the same projection on `nightStyle().layers`. Any drift here silently breaks the "no relayout flash" guarantee.

Run `npm test` — these tests fail because the styles still reference demotiles. Expected.

**Step A6 — Replace `dayStyle` and `nightStyle`** *([frontend])*

Rewrite `client/src/features/map/styles/day.ts` and `.../night.ts` so each exports a `StyleSpecification` matching the test contract above.

Layer paint values:

- `background` — light: `#e6eef5`; dark: `#05090f`.
- `country-fill` — light: `#f8f7f2`; dark: `#0f1626`.
- `country-boundary` — `line-color` light `#c9c3b5` / dark `#24324a`, `line-width` 0.7.
- `state-boundary` — `minzoom: 3`, `line-color` light `#dcd5c2` / dark `#1c2740`, `line-width` 0.4.
- `graticules` — `line-color` light `#d8d3c7` / dark `#1b2536`, `line-width` 0.4, `line-dasharray: [2, 2]`.
- `country-label` — `text-field: ['get', 'NAME']`, `text-font: ['Open Sans Regular']`, zoom-interpolated `text-size` (2 → 10, 4 → 12, 6 → 14).
- `city-label` — `minzoom: 4`, `text-field: ['get', 'name']`, `filter: ['<=', ['get', 'rank_max'], ['interpolate', ['linear'], ['zoom'], 4, 3, 6, 6, 8, 9]]`. Smaller text size than country-label, same fontstack.

Reference shape (extract a `themedStyle(theme: 'light' | 'dark')` factory if shared layer structure tempts duplication; otherwise keep two `StyleSpecification` builders — both are acceptable).

Run the style tests — they should now pass.

**Step A7 — Update MapView to use the new zoom range** *([frontend])*

In `client/src/features/map/MapView.tsx` import `BASEMAP_MAX_ZOOM` from the constants module created in A0.7, then use it in both places:

```ts
import { BASEMAP_MAX_ZOOM } from './constants';
// in the maplibregl.Map ctor: maxZoom: BASEMAP_MAX_ZOOM
// in fitBounds(...):          maxZoom: BASEMAP_MAX_ZOOM
```

(Replaces the existing `maxZoom: 6` ctor field and `maxZoom: 10` fitBounds field.)

Verify in dev mode: visit `http://localhost:5173/fonts/Open%20Sans%20Regular/0-255.pbf` and confirm a binary download. Visit `http://localhost:5173/basemap/countries.json` and confirm a JSON response.

**Step A8 — Smoke-test offline** *(manual)*

```bash
# Terminal 1
npm start
# Terminal 2
cd client && npm run dev
```

In Chrome DevTools Network tab → Offline → reload `/map`. Expected: countries, states, cities, and graticules all render; no network requests fail. Take a screenshot saved to `map-offline.png` in the repo root for the PR.

Run `git grep -inE 'demotiles|naciscdn'` outside `scripts/` and PROGRESS/SPECIFICATION docs — should return zero results.

**Step A9 — Cleanup** *([frontend][backend][tests])*

The uncommitted `git status` already deletes the PMTiles surface. After Phase A, also confirm these no longer exist anywhere in the codebase:
- `client/src/features/map/pmtiles.ts`
- `scripts/buildMapTiles.ts`
- `src/api/routes/basemap.ts`
- `tests/api/Basemap.test.ts`
- The `pmtiles` dependency in `client/package.json` (run `npm uninstall pmtiles` inside `client/`).

Phase A acceptance: `npm test`, `npm run lint`, `cd client && npm run lint`, `npm run build` (root `tsc --noEmit`) all pass. Manual offline reload of `/map` works. `git grep -i pmtiles` returns zero results outside docs.

---

#### Phase B — Performance fixes + backend cache (~0.75 day)

**Goal**: eliminate per-window-tick GPU vertex rebuilds, eliminate redundant array passes, stop fly-to from yanking the user back on data refetches, and avoid re-walking the entire graph on every request.

> **Note on B1 (pre-bucketing).** The previous version of this plan called for indexing events into per-year buckets. Dropped — at the realistic scale (≤ 10K events) `events.filter(...)` is sub-millisecond, and pre-bucketing duplicates range events across years requiring downstream dedupe. The real perf wins are stable accessors, `updateTriggers`, and the backend cache (B7).

> **Recommended execution order (decided post-Phase-A):** Land B7+B8 first (backend cache + tests, fully independent of frontend). Then B5 (`timeStore` test — implementation already shipped in A0.3, only the test remains). Then B1+B2+B3 together as one frontend commit (they all touch `buildMapLayers.ts` + `MapView.tsx`). Then B4 standalone. Defer B6 to land alongside C5's Radix dual-handle replacement to avoid double-work; if Phase B happens to ship before C5, do the rAF batching against the native `<input type="range">` and rewire in C5.

> **Commit shape:** Single commit per step group (e.g. one commit for B7+B8). Avoid splitting `graph-updated` event emission from its consumer — a state where the event exists with no consumer harms `git bisect` clarity.

> **`graph-updated` consumer scope:** Only `/api/map/events`'s LRU cache. Search index and hydration progress already have working invalidation via existing events; adding speculative consumers risks behavior changes outside Phase B's design intent.

> **Visual regression coverage:** B1–B4 are internal refactors with no intended visual change. The `npm run test:visual` harness (committed in `27835ad`) will fail on any unintended drift. **Caveat for B4**: the harness stubs `/api/map/events` to empty, which short-circuits the `fitBounds` effect — so the harness does NOT cover the corrected fly-to behavior. Add a non-snapshot Playwright test (or a unit test on the ref-keyed guard logic) explicitly for the "events count change → refit" case.

**Step B1 — Pre-jitter event positions on data arrival** *([frontend])*

In `client/src/features/map/MapView.tsx`, fold a single `useMemo` that pre-computes `jitteredLng`/`jitteredLat`. Key on React Query's `dataUpdatedAt` fingerprint, **not** on the `events.data` object reference — Query produces a new reference on every refetch even when bytes are identical, which would re-jitter unnecessarily.

```ts
import { jitterOffset } from './layers/buildMapLayers';

const jitteredEvents = useMemo(() => {
    const all = events.data?.events ?? [];
    return all.map(e => {
        const [dx, dy] = jitterOffset(e.id);
        return { ...e, jitteredLng: e.lng + dx, jitteredLat: e.lat + dy };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [events.dataUpdatedAt]);
```

Pass `jitteredEvents` into `buildMapLayers` and update `BuildLayersArgs.events` to `Array<MapEvent & { jitteredLng: number; jitteredLat: number }>`.

Add `jitteredLng`/`jitteredLat` to a new internal type in `buildMapLayers.ts` (don't pollute the public `MapEvent` type in `types.ts`).

**Step B2 — Hoist accessors to module scope** *([frontend])*

In `client/src/features/map/layers/buildMapLayers.ts`, lift these to module scope:

```ts
type JitteredEvent = MapEvent & { jitteredLng: number; jitteredLat: number };

const getPosition = (e: JitteredEvent): [number, number] => [e.jitteredLng, e.jitteredLat];
const getFillColor = (e: MapEvent): [number, number, number, number] =>
    TYPE_COLORS[e.type] ?? [200, 200, 200, 220];
const getRadius = (): number => 6;
const getWeight = (e: MapEvent): number => TYPE_WEIGHTS[e.type] ?? 0.5;
```

Pass them by reference into `ScatterplotLayer` / `HeatmapLayer` / `PathLayer` constructors. **Do not** add `updateTriggers` for any of these — they don't close over reactive state. The path layer's `getColor` is fine to inline because the path layer is rebuilt per-call to `buildMapLayers` anyway.

**Step B3 — Memoize focal `personEvents`** *([frontend])*

Currently the path layer iterates the full events list every call. Hoist into MapView:

```ts
const personEvents = useMemo(() => {
    if (scope !== 'focal' || !focalPersonId) return null;
    return jitteredEvents
        .filter(e => e.person_id === focalPersonId && e.sort_date)
        .sort((a, b) => (a.sort_date ?? '').localeCompare(b.sort_date ?? ''));
}, [jitteredEvents, scope, focalPersonId]);
```

Pass `personEvents` into `buildMapLayers` (new arg). Remove the inner filter/sort block in `buildMapLayers`.

**Step B4 — Fix `fitBounds` re-trigger on refetch** *([frontend])*

Replace the existing fly-to effect with a ref-keyed guard. **Include the event count in the key** so that a hot-patch that genuinely adds events (changing the bbox) does refit, while idempotent refetches do not.

```ts
import { BASEMAP_MAX_ZOOM } from './constants';

const lastFlownToKey = useRef<string | null>(null);
useEffect(() => {
    if (!mapRef.current || !events.data) return;
    const key = `${scope}:${focalPersonId ?? '_'}:${events.data.events.length}`;
    if (lastFlownToKey.current === key) return;
    const bbox = events.data.extent.bbox;
    if (!bbox) return;
    const [w, s, e, n] = bbox;
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 60, duration: 400, maxZoom: BASEMAP_MAX_ZOOM });
    lastFlownToKey.current = key;
}, [scope, focalPersonId, events.data]);
```

Acceptance: switching scope flies; switching focal flies; an idempotent React Query refetch does **not** fly; adding a person in another tab (hot-patch with new geocoded events) does fly.

**Step B5 — Unit tests for `initWindowForExtent`** *([tests])*

The `extentSeeded` field and gating logic were already implemented in **Step A0.3** (single-step migration to avoid intermediate state). All that remains under B5 is the unit test.

Add `client/src/features/map/timeStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimeStore, initWindowForExtent } from './timeStore';
import { useMapPrefsStore } from './prefsStore';

describe('initWindowForExtent', () => {
    beforeEach(() => {
        useTimeStore.setState({ extentSeeded: false, windowStart: 1900, windowEnd: 2000 });
        useMapPrefsStore.setState({ granularity: 'decade' });
    });

    it('seeds a granularity-sized window on first call', () => {
        initWindowForExtent('1800-01-01', '2000-01-01');
        const s = useTimeStore.getState();
        expect(s.extentStart).toBe(1800);
        expect(s.extentEnd).toBe(2000);
        expect(s.windowStart).toBe(1800);
        expect(s.windowEnd).toBe(1820); // decade => 20-year width
        expect(s.extentSeeded).toBe(true);
    });

    it('does not reset the window on subsequent calls', () => {
        initWindowForExtent('1800-01-01', '2000-01-01');
        useTimeStore.setState({ windowStart: 1900, windowEnd: 1950 });
        initWindowForExtent('1700-01-01', '2050-01-01');
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1900);
        expect(s.windowEnd).toBe(1950);
    });
});
```

**Step B6 — rAF-batch slider scrub + `pointerup` listener** *([frontend])*

In `client/src/features/map/TimeSlider.tsx`, route the dual-handle `onValueChange` through a rAF queue (this lands together with C5's Radix dual-handle replacement; if Phase B happens first, do it for the native `<input type="range">` and rewire in C5):

```ts
const pendingValue = useRef<[number, number] | null>(null);
const rafId = useRef<number | null>(null);
const flushScrub = () => {
    rafId.current = null;
    const v = pendingValue.current;
    pendingValue.current = null;
    if (v) setWindow(v[0], v[1]);
};
const scheduleRaf = () => {
    if (rafId.current === null) rafId.current = requestAnimationFrame(flushScrub);
};
```

For scrub-end-off-element, attach `pointerup` to `window` on scrub start. **Stash the listener in a ref** so the unmount cleanup can remove it if the user navigates away mid-drag (otherwise it leaks):

```ts
const onUpRef = useRef<((e: PointerEvent) => void) | null>(null);

function onScrubStart() {
    scrubRef.current.wasPlayingBeforeScrub = isPlaying;
    if (isPlaying) setPlaying(false);
    const onUp = () => {
        scrubRef.current.wasPlayingBeforeScrub = false;
        if (onUpRef.current) window.removeEventListener('pointerup', onUpRef.current);
        onUpRef.current = null;
    };
    onUpRef.current = onUp;
    window.addEventListener('pointerup', onUp);
}
```

Combined cleanup (covers both rAF and a straggler `pointerup`):

```ts
useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    if (onUpRef.current) window.removeEventListener('pointerup', onUpRef.current);
}, []);
```

Drop the inline `onMouseUp` / `onTouchEnd` handlers.

**Step B7 — Server-side response cache (LRU + generation guard + emission)** *([backend])*

Three coordinated changes:

**(a)** Add a `'graph-updated'` event to `GraphEngine` (`src/core/GraphEngine.ts`). `GraphEngine` already extends `EventEmitter` and emits `hydration:complete`; no new wiring is needed beyond `this.emit('graph-updated')` at the points the graph is observably mutated. Concretely, emit at the end of:

- Both `hydration:complete` emissions (currently `~:211` and `~:250`) — emit `graph-updated` immediately after.
- The success branch of every hot-patch path. Search `src/core/GraphEngine.ts` for `console.log('[GraphEngine] hot-patched`) — there are 5+ sites covering person create / update / delete / story / asset patches. Add `this.emit('graph-updated')` at the bottom of each successful branch.
- The `removePerson` and `removeStory` cleanup paths.

Add a one-line vitest in `tests/core/GraphEngine.test.ts` that subscribes to `graph-updated` and counts emissions across (i) hydration completion and (ii) a synthetic `applyPersonPatch` call.

**(b)** Bound the cache and guard against in-flight invalidation races.

```ts
// src/api/routes/map.ts
import { FastifyInstance } from 'fastify';
import type { AppInstance } from '../types';
// … existing imports …

class LRU<K, V> {
    private m = new Map<K, V>();
    constructor(private max: number) {}
    get(k: K): V | undefined {
        const v = this.m.get(k);
        if (v === undefined) return;
        this.m.delete(k); this.m.set(k, v); return v;
    }
    set(k: K, v: V): void {
        if (this.m.has(k)) this.m.delete(k);
        else if (this.m.size >= this.max) {
            const oldest = this.m.keys().next().value;
            if (oldest !== undefined) this.m.delete(oldest);
        }
        this.m.set(k, v);
    }
    clear(): void { this.m.clear(); }
}

export async function mapRoutes(server: FastifyInstance) {
    const { graphEngine } = (server as AppInstance).appServices;
    const cache = new LRU<string, MapEventsResponse>(32);
    let gen = 0;
    graphEngine.on('graph-updated', () => { gen++; cache.clear(); });

    server.get<{ Querystring: { person?: string; lineage?: string } }>(
        '/api/map/events',
        async (request, reply) => {
            const { person, lineage } = request.query;
            if (person && lineage) {
                return reply.status(400).send({ error: 'Pass either ?person or ?lineage, not both', code: 'VALIDATION_ERROR' });
            }
            // Cache key: matches §6.11's `${scope}:${focalPersonId ?? '_'}` shape.
            const cacheKey = lineage ? `lineage:${lineage}` : person ? `person:${person}` : 'all:_';
            const cached = cache.get(cacheKey);
            if (cached) return cached;

            const myGen = gen;

            // … existing computation, ending with `const response = { events, extent };` …

            // Only memoize if no graph update raced us mid-computation.
            if (myGen === gen) cache.set(cacheKey, response);
            return response;
        },
    );
}
```

**(c)** The cache key shape matches the spec (`scope:focalId`). The route's mutually-exclusive `?person` / `?lineage` querystring is preserved — the spec prose around cache keys is reconciled against this shape (see updated §6.11).

**Step B8 — Backend route tests** *([tests])*

Create `tests/api/MapEvents.test.ts`. Match the existing scaffolding pattern in `tests/api/` — look at `tests/api/Server.test.ts` for the canonical `buildTestServer` (or whatever the helper is named) import. The cache-invalidation case is the most subtle, so its body is fully written here as the reference; the others follow the same pattern.

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildTestServer } from '../helpers/buildTestServer';

describe('GET /api/map/events', () => {
    it('200 with no params returns geocoded events', async () => {
        const server = await buildTestServer();
        const r = await server.inject({ method: 'GET', url: '/api/map/events' });
        expect(r.statusCode).toBe(200);
        expect(JSON.parse(r.body).events).toEqual(expect.any(Array));
    });

    it('400 when both person and lineage are passed', async () => {
        const server = await buildTestServer();
        const r = await server.inject({ method: 'GET', url: '/api/map/events?person=X&lineage=X' });
        expect(r.statusCode).toBe(400);
    });

    it('404 for unknown person id', async () => { /* … same shape … */ });

    it('extent.bbox is correctly computed', async () => { /* … fixture-based … */ });

    it('events with sort_date=null are returned but excluded from extent.minDate/maxDate', async () => { /* … */ });

    it('cache invalidates on graph-updated emission', async () => {
        const server = await buildTestServer();
        // First call: cache miss, computes response.
        const r1 = await server.inject({ method: 'GET', url: '/api/map/events' });
        expect(r1.statusCode).toBe(200);

        // Spy on the graph walk used inside the route.
        const graph = server.appServices.graphEngine.getGraph();
        const spy = vi.spyOn(graph, 'forEachNode');

        // Second call within the cache window: should NOT walk the graph.
        await server.inject({ method: 'GET', url: '/api/map/events' });
        expect(spy).not.toHaveBeenCalled();

        // Emit graph-updated; cache clears; next call walks again.
        server.appServices.graphEngine.emit('graph-updated');
        await server.inject({ method: 'GET', url: '/api/map/events' });
        expect(spy).toHaveBeenCalled();
    });
});
```

The `appServices` access path mirrors `(server as AppInstance).appServices` from `src/api/routes/map.ts`.

**Phase B acceptance**: `npm test`, `npm run lint`, `cd client && npm run lint` pass. Manual: scrub the slider rapidly with DevTools Performance recording; flame chart shows ≤ 1 layer rebuild per frame instead of 4–8. Refetch via `queryClient.invalidateQueries` does not retrigger fly-to. `tail -f` the Fastify log — repeated `/api/map/events?person=X` requests within the cache window log nothing about graph traversal.

---

#### Phase C — Missing UX (~1.25 days)

**Step C1 — Failing tests for `buildMapLayers`** *([tests])*

Create `client/src/features/map/layers/buildMapLayers.test.ts`. Tests:

1. `zoom < 3` returns one layer with id `events-heatmap`.
2. `zoom >= 5` returns one layer with id `events-pins`.
3. `3 <= zoom < 5` returns both layers.
4. `scope: 'focal'` with `personEvents.length >= 2` emits a `focal-path` layer **and** a `focal-path-halo` layer; with `< 2` events does not.
5. Window filtering: events outside the window are omitted from both layers.
6. `eventTypes: ['birth']` filters out non-birth events.
7. `eventTypes: null` is equivalent to no filter.
8. `eventTypes: []` filters out all events (empty visible set).
9. `jitterOffset(id)` returns the same `(dx, dy)` for the same id across calls.

Run; expect failures because `eventTypes`, the path halo layer, and the empty-array semantics do not exist yet.

**Step C2 — Wire `eventTypes` filter in `buildMapLayers`** *([frontend])*

Add `eventTypes: EventType[] | null` (type from the registry created in A0.6) to `BuildLayersArgs`. Apply at the same point as the time-window filter:

```ts
const matchesType = (e: MapEvent) =>
    eventTypes === null ? true : eventTypes.includes(e.type as EventType);
const visible = events.filter(e =>
    isEventInWindow(e.sort_date, e.sort_end_date, windowStart, windowEnd, showUndated)
    && matchesType(e),
);
```

Pass through from `MapView.tsx`:

```ts
const eventTypes = useMapPrefsStore((s) => s.eventTypes);
// inside useMemo deps:
[jitteredEvents, zoom, windowStart, windowEnd, showUndated, scope, focalPersonId, theme, eventTypes, personEvents]
```

**Heatmap weighting note.** Muting `census` (weight 0.3) shifts the heatmap intensity normalization — the gradient will visibly redistribute. This is correct behavior, not a bug; do not "fix" it by post-normalizing weights against the visible set.

**Step C3 — Event-type filter UI in `MapToolbar`** *([frontend])*

Add a `MapToolbar` overflow button with `lucide-react` `Filter` icon. Use `<DropdownMenu>` from `client/src/shared/ui/dropdown-menu` (shadcn). Each menu item is a checkbox bound to `eventTypes` membership; toggle behavior:

- Clicking a type when `eventTypes === null` switches to `[…ALL_TYPES].filter(t => t !== clicked)`.
- Clicking a type when it's the only one in the array clears `eventTypes` to `null`.
- Otherwise toggles set membership.
- An "All types" entry at the top clears the filter (`setEventTypes(null)`).

Import `EVENT_TYPES` and `TYPE_COLORS` from `client/src/features/map/eventTypes.ts` (created in A0.6) so the toolbar and legend share the source of truth — never from `buildMapLayers.ts`.

**Step C4 — `MapLegend` component** *([frontend])*

Create `client/src/features/map/MapLegend.tsx`. Bottom-left positioning, mirrors `MapToolbar`'s style. Collapsed by default to a single button with the `Palette` icon (lucide); expands to a list of color swatches keyed by `TYPE_COLORS`. Each row is clickable and toggles the same `eventTypes` membership as Step C3 — the legend doubles as a one-click filter UI. Active filter rows show a checkmark; muted types render at 40% opacity.

Wire it into `MapView.tsx` as a sibling of `<MapToolbar />`.

**Step C5 — Dual-handle range slider via Radix** *([frontend])*

Replace the native `<input type="range">` in `TimeSlider.tsx` with `@radix-ui/react-slider` range mode (Radix is already available — `npm install --save @radix-ui/react-slider` inside `client/` if not already a direct dep).

```tsx
import * as Slider from '@radix-ui/react-slider';

<Slider.Root
    className="relative flex h-5 w-full items-center"
    min={extentStart}
    max={extentEnd}
    step={GRANULARITY_WIDTH[granularity]}
    value={[windowStart, windowEnd]}
    onValueChange={([s, e]) => { pendingValue.current = [s, e]; scheduleRaf(); }}
    onPointerDown={onScrubStart}
>
    <Slider.Track className="relative h-1 grow rounded-full bg-muted">
        <Slider.Range className="absolute h-full rounded-full bg-primary" />
    </Slider.Track>
    <Slider.Thumb aria-label="Window start" className="block h-4 w-4 rounded-full border-2 border-primary bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    <Slider.Thumb aria-label="Window end"   className="block h-4 w-4 rounded-full border-2 border-primary bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
</Slider.Root>
```

**Playback contract** — explicitly document and implement:

```ts
useEffect(() => {
    if (!isPlaying) return;
    const stepYears = GRANULARITY_WIDTH[granularity];
    const stepMs = MS_PER_UNIT[granularity] / speed;
    const id = setInterval(() => {
        const { windowStart: ws, windowEnd: we, extentStart: es, extentEnd: ee } = useTimeStore.getState();
        const width = we - ws; // read FRESH each tick — user may drag mid-playback
        let nextStart = ws + stepYears;
        let nextEnd = nextStart + width;
        if (nextEnd > ee) {
            if (loop) {
                nextStart = es;
                nextEnd = nextStart + width;
            } else {
                setWindow(ee - width, ee);
                setPlaying(false);
                return;
            }
        }
        setWindow(nextStart, nextEnd);
    }, stepMs);
    return () => clearInterval(id);
}, [isPlaying, granularity, speed, loop, setWindow, setPlaying]);
```

Update keyboard handlers to shift both handles by `stepYears` (preserving fresh width). Read width fresh from `useTimeStore.getState()` per keypress so a mid-drag arrow press uses the user's current window.

**Keyboard target-role guard.** Radix's slider thumb has `role="slider"` and natively consumes `ArrowLeft`/`ArrowRight`. Without a guard, the global `keydown` listener on `window` *also* fires and double-steps the window. Tighten the existing early-return in `TimeSlider.tsx`:

```ts
const target = e.target as HTMLElement | null;
const tag = target?.tagName;
const role = target?.getAttribute('role');
if (tag === 'INPUT' || tag === 'TEXTAREA' || role === 'slider') return;
```

This must land in C5; the existing single-handle `<input type="range">` would also trigger it, so the guard is a strict superset of the current `tag === 'INPUT'` check.

**Step C6 — Wire `?event=<id>` deep link with synchronous open/close** *([frontend])*

The naïve `didOpenFromUrl: useRef(false)` design **breaks on second navigation**: TanStack Router keeps `MapView` mounted across in-app nav to/from `/map`, so the ref stays `true` and pasting a new `?event=…` URL into the address bar silently fails to open the drawer. Key the gate to the URL value itself, not a one-shot flag:

```ts
// MapView.tsx
const lastOpenedEventId = useRef<string | null>(null);
useEffect(() => {
    if (!events.data) return;
    if (search.event === lastOpenedEventId.current) return;
    lastOpenedEventId.current = search.event ?? null;
    if (!search.event) return;
    const target = events.data.events.find(e => e.id === search.event);
    if (target) setOpenEvent(target);
}, [search.event, events.data]);
```

This naturally re-opens on URL paste (different `search.event`) while ignoring our own internal navigations (`handlePinClick` / `handleDrawerClose` synchronously update the same ref before the effect re-runs).

Open synchronously writes the URL — and updates `lastOpenedEventId` to suppress the effect's re-fire:

```ts
function handlePinClick(evt: MapEvent) {
    lastOpenedEventId.current = evt.id;
    setOpenEvent(evt);
    navigate({ to: '/map', search: (prev) => ({ ...prev, event: evt.id }), replace: true });
}
```

Close synchronously clears the URL:

```ts
function handleDrawerClose() {
    lastOpenedEventId.current = null;
    setOpenEvent(null);
    navigate({ to: '/map', search: (prev) => ({ ...prev, event: undefined }), replace: true });
}
```

**Drop `search.event` from the debounced URL writeback's dependency list** so the synchronous calls remain authoritative for `?event=`.

**Step C7 — Loading-state and empty-state overlays** *([frontend])*

In `MapView.tsx`, render two overlays inside the existing `<div className="relative h-full w-full">`:

```tsx
{events.isPending && (
    <div className="absolute inset-x-0 top-16 z-10 flex justify-center pointer-events-none">
        <div className="rounded-full border border-border bg-card/90 backdrop-blur-sm shadow px-4 py-1.5 text-xs">
            Loading events…
        </div>
    </div>
)}
{events.data && events.data.events.length === 0 && (
    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
        <div className="pointer-events-auto max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg text-center">
            <p className="text-sm font-medium mb-2">No events with coordinates yet</p>
            <p className="text-xs text-muted-foreground mb-4">
                Geocode places in Settings → Geocoding to see events on the map.
            </p>
            <Link to="/settings"><Button size="sm" variant="secondary">Open Settings</Button></Link>
        </div>
    </div>
)}
```

**Step C8 — PathLayer halo** *([frontend])*

In `buildMapLayers.ts`, when `personEvents` is provided, emit two stacked `PathLayer`s:

```ts
if (personEvents && personEvents.length >= 2) {
    const path = personEvents.map(e => [e.jitteredLng, e.jitteredLat] as [number, number]);
    const stroke: [number, number, number, number] = theme === 'dark' ? [236, 170, 70, 220] : [180, 95, 30, 220];
    const halo:   [number, number, number, number] = theme === 'dark' ? [5, 9, 15, 200]    : [248, 247, 242, 220];
    layers.push(new PathLayer({
        id: 'focal-path-halo',
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: halo,
        getWidth: 5,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
    }));
    layers.push(new PathLayer({
        id: 'focal-path',
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: stroke,
        getWidth: 3,
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
    }));
}
```

The halo must render BEFORE the stroke so the stroke draws on top.

**Step C9 — Heatmap zoom-interpolated radius** *([frontend])*

In `buildMapLayers.ts`, change `radiusPixels: 40` to a zoom-interpolated value. deck.gl's `HeatmapLayer` accepts a literal number — to vary by zoom, recompute when `zoom` changes:

```ts
const heatmapRadiusPx = Math.round(30 + Math.max(0, Math.min(zoom, 5)) * 6); // 30 → 60
// in the HeatmapLayer config:
radiusPixels: heatmapRadiusPx,
```

The `useMemo` for `layers` already keys on `zoom`, so no extra invalidation is required.

**Step C10 — Mobile drawer 40 vh + drag handle** *([frontend])*

In `client/src/features/map/EventDrawer.tsx`, replace the existing mobile branch with a 40 vh sheet + drag-down handle. Use a small inline pointer-event handler (no new dep needed):

```tsx
import { useRef } from 'react';

function useSwipeDownToClose(onClose: () => void) {
    const startY = useRef<number | null>(null);
    const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
        startY.current = e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
        if (startY.current === null) return;
        const dy = e.clientY - startY.current;
        if (dy > 80) {
            startY.current = null;
            onClose();
        }
    };
    const onPointerUp = () => { startY.current = null; };
    return { onPointerDown, onPointerMove, onPointerUp };
}

// In the drawer:
const swipe = useSwipeDownToClose(onClose);
<aside className="… h-[40vh] md:h-full …">
    <div
        className="md:hidden mx-auto mt-2 h-1.5 w-9 rounded-full bg-muted-foreground/30 cursor-grab"
        {...swipe}
    />
    {/* … rest of the drawer … */}
</aside>
```

Update the desktop branch to keep `md:h-full md:w-96`. Dropping the existing `h-1/2` class and the manual `inset-0 bg-black/20` overlay is required.

**Step C11 — URL hygiene** *([frontend])*

In the debounced URL writeback effect in `MapView.tsx`:

```ts
const atExtentStart = Math.round(windowStart) === extentStart;
const atExtentEnd   = Math.round(windowEnd) === extentEnd;
navigate({
    to: '/map',
    search: (prev) => ({
        ...prev,
        scope: scope === 'all' ? undefined : scope,
        person: focalPersonId ?? undefined,
        g: granularity === 'decade' ? undefined : granularity,
        speed: speed === 1 ? undefined : speed,
        loop: loop ? 1 : undefined,
        play: isPlaying ? 1 : undefined,
        t:     atExtentStart ? undefined : Math.round(windowStart),
        t_end: atExtentEnd   ? undefined : Math.round(windowEnd),
        // event handled synchronously by C6 — do not write here
    }),
    replace: true,
});
```

Remove `search.event` from the effect's dep list.

**Phase C acceptance**: all `buildMapLayers` tests pass; all `timeStore` tests pass; manual smoke shows event-type filter, dual-handle slider with mid-playback drag, legend, deep-link drawer (round-trips on share-paste), loading/empty states, mobile 40 vh drawer with swipe-down, all working.

---

#### Phase D — Hygiene + E2E (~0.75 day)

**Step D1 — Squash the PMTiles cycle** *(branch hygiene)*

**Status (2026-05-02):** The PMTiles surface was deleted in `bbf0225` ("Remove PMTiles basemap surface"). The working-tree deletions referenced in earlier drafts of this plan are no longer pending. The three abandoned PMTiles commits (`40cc5f6`, `1b7a9d3`, `033519f`) are followed in history by `bbf0225` (deletion) and the current Phase A0/A/harness commits. Decide before Phase D PR:

- **If the branch has not been pushed**: `git rebase -i main` and squash `40cc5f6 → 1b7a9d3 → 033519f → bbf0225` into one "Add bundled Natural Earth basemap" commit. Rewrite the message to reflect the final shipped design.
- **If the branch is already shared** (typical for a long-lived feature branch): leave history as-is. The PMTiles excursion is a public artifact at this point and rewriting it costs more than it saves.

Either way, `git grep -i pmtiles` should return zero results outside `PROGRESS.md`/`SPECIFICATION.md` historical sections.

**Step D2 — Fold `MAP_VIEW.md` into `SPECIFICATION.md`** *(docs)*

`SPECIFICATION.md` §6.11 is the canonical spec. If `MAP_VIEW.md` exists, delete it. (At time of writing it does not — note included for completeness.)

**Step D3 — E2E test** *([tests])*

> The visual-regression harness (`tests/e2e/map-snapshots.spec.ts`, run via `npm run test:visual`) already covers the basemap rendering across 5 locations × 2 themes — committed in `27835ad`. This step adds a *user-flow* E2E that complements the visual harness; do **not** duplicate basemap rendering checks here.

Create `tests/e2e/map.spec.ts` using the existing Playwright pattern (`tests/e2e/people.spec.ts` for reference). **Seed the test workspace via the existing isolation helper** — reuse the `setupTestDataDir()` pattern from `tests/e2e/helpers/` (or whichever helper `people.spec.ts` uses) and import a fixture with at least three geocoded events before the first test (`tests/fixtures/geocoded-3-people.ged`, creating it from a real `.ged` snippet if one doesn't yet exist).

Cover:

1. Navigate to `/map`; at least one heatmap glow renders within 5 s.
2. Drag the time slider's right handle; the heatmap visibly changes.
3. Click `Filter` → uncheck `census`; pin count drops.
4. Set focal via Graph; navigate `/map`; click "Focal lineage"; URL contains `scope=lineage&person=N_…`.
5. Click any pin; share the URL; in a new tab the same drawer opens.
6. Toggle dark mode; verify map paint changes (assert background color via DOM inspector).

Skip the offline-Network test in E2E (Playwright's offline mode is brittle across browsers) — keep that as a manual step in the verification checklist.

**Step D4 — Lint, type-check, test** *(verification)*

```bash
npm test
npm run test:e2e
npm run test:visual         # visual-regression harness (10 baselines)
npm run lint
cd client && npm run lint
npm run build
```

All must pass with zero errors per `CLAUDE.md` rule 5. `npm run test:visual` requires the dev backend (`:3000`) and Vite (`:5173`) to be running — boot them in two separate terminals first, or use `npm run test:e2e` which manages its own servers (but does not run the visual harness).

**Step D5 — Final screenshots** *(docs)*

Save `map-offline.png`, `map-light.png`, and `map-dark.png` in the repo root for the PR description.

Phase D acceptance: `git log --oneline main..HEAD` shows a clean, squashed history; no `MAP_VIEW.md`, no PMTiles references; tests + lint + build green; E2E covers golden-path scenarios.

---

### How to verify the whole feature end-to-end

After all five phases:

1. `git checkout main && git pull && git checkout map-view`
2. `rm -rf client/node_modules client/dist && cd client && npm ci && cd ..`
3. `npm ci`
4. `npm start &` (backend on :3000)
5. `cd client && npm run dev` (frontend on :5173)
6. Open browser → DevTools Network → check **Offline** → navigate to `/map`.
7. Expected: countries, states, cities, graticules render; pins/heatmap render from the cached `GET /api/map/events`; no network requests beyond `localhost`.
8. Toggle dark mode → map re-styles instantly with no relayout flash (verifies A0.2 + spec promise).
9. Set a focal person on `/`; navigate to `/map`; verify scope toolbar enables, lineage scope shows ancestors+descendants only, focal scope shows the path layer with halo.
10. Drag both slider handles; verify width changes; press Space to play; drag a handle mid-playback and verify the next step uses the new width; verify smooth playback with no jank in DevTools Performance.
11. Open the legend; toggle `census` off; verify census events disappear from the heatmap.
12. Click a pin; copy the URL; paste in a new tab; verify the same event drawer opens.
13. Resize the window to < 768 px; click a pin; verify the drawer is a 40 vh bottom sheet with a drag handle; swipe down ≥ 80 px; verify the drawer dismisses.
14. Reload the page mid-playback; verify the window does NOT reset (URL was honored) but the page is in a paused state (URL omits `play=1` until next playback).

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
