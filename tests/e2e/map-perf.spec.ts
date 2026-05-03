import { test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Map zoom-perf trace harness.
 *
 *   npx playwright test tests/e2e/map-perf.spec.ts --config=playwright.config.perf.ts
 *
 * Drives a fixed, scripted zoom sequence via `window.__map.zoomTo()` while
 * Chrome's tracing API records a DevTools-compatible profile. The trace
 * lands at `tests/e2e/perf-traces/<scenario>-<theme>.json` — open it in
 * Chrome DevTools → Performance → Load profile.
 *
 * Two scenarios:
 *   `full-range`   — zoom 1 → 8 → 1, exercises every crossfade boundary.
 *   `high-zoom`    — oscillates 5 ↔ 8, the range the user reports as choppy.
 *
 * Test-only API endpoint stub returns a small synthetic event set so the
 * trace is independent of fixture data. Disable that stub if you need to
 * trace the real production graph.
 */

interface Scenario {
    name: string;
    /** [zoom, msToHoldAfter] pairs. zoomTo uses the duration; the hold lets
     *  the trace capture idle frames between transitions. */
    steps: Array<[number, number]>;
    /** Optional: hide named layer ids before recording. Used for ad-hoc
     *  bisection (e.g. hide all symbol layers to test whether the worker
     *  cost lives in symbol layout). */
    hideLayers?: string[];
}

const SCENARIOS: Scenario[] = [
    {
        name: 'full-range',
        steps: [
            [1, 200],
            [4, 200],
            [6, 200],
            [8, 400],
            [6, 200],
            [4, 200],
            [1, 400],
        ],
    },
    {
        name: 'high-zoom',
        steps: [
            [5, 200],
            [6, 200],
            [7, 200],
            [8, 200],
            [7, 200],
            [6, 200],
            [5, 200],
            [7, 200],
            [5, 400],
        ],
    },
];

const ZOOM_DURATION_MS = 600;
const TRACE_DIR = path.resolve('tests/e2e/perf-traces');
const SYNTHETIC_EVENTS = makeSyntheticEvents(2_000);

function makeSyntheticEvents(n: number) {
    const events = [];
    let minYear = Infinity;
    let maxYear = -Infinity;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (let i = 0; i < n; i++) {
        // Cluster around major cities so the heatmap has hot spots.
        const cluster = i % 5;
        const cx = [-74, -0.1, 139.7, -118.2, 2.35][cluster];
        const cy = [40.7, 51.5, 35.7, 34.05, 48.85][cluster];
        const lng = cx + (Math.random() - 0.5) * 4;
        const lat = cy + (Math.random() - 0.5) * 4;
        const year = 1800 + Math.floor(Math.random() * 220);
        events.push({
            id: `e${i}`,
            person_id: `p${i % 100}`,
            person_name: `Person ${i % 100}`,
            type: ['birth', 'death', 'marriage', 'residence', 'occupation'][i % 5],
            lat,
            lng,
            sort_date: `${year}-06-15`,
            sort_end_date: null,
            has_assets: false,
            place_name: ['New York', 'London', 'Tokyo', 'Los Angeles', 'Paris'][cluster],
        });
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
    }
    return {
        events,
        extent: {
            minDate: `${minYear}-01-01`,
            maxDate: `${maxYear}-12-31`,
            bbox: [minLng, minLat, maxLng, maxLat],
        },
    };
}

async function settleAtZoom(page: Page, zoom: number): Promise<void> {
    await page.evaluate(
        ({ zoom }) =>
            new Promise<void>((resolve, reject) => {
                type MaybeMap = {
                    jumpTo: (opts: { zoom: number }) => void;
                    loaded: () => boolean;
                    areTilesLoaded: () => boolean;
                    once: (event: string, cb: () => void) => void;
                };
                const deadline = Date.now() + 30_000;
                let stableSince = 0;
                let lastMap: MaybeMap | undefined;
                const tick = () => {
                    const map = (window as unknown as { __map?: MaybeMap }).__map;
                    if (map) {
                        if (map !== lastMap) {
                            lastMap = map;
                            stableSince = Date.now();
                        } else if (Date.now() - stableSince >= 500) {
                            map.jumpTo({ zoom });
                            if (map.loaded() && map.areTilesLoaded()) resolve();
                            else map.once('idle', () => resolve());
                            return;
                        }
                    } else {
                        stableSince = 0;
                        lastMap = undefined;
                    }
                    if (Date.now() > deadline) {
                        reject(new Error('timeout waiting for stable window.__map'));
                        return;
                    }
                    setTimeout(tick, 50);
                };
                tick();
            }),
        { zoom },
    );
}

async function runZoomSequence(page: Page, scenario: Scenario): Promise<void> {
    for (const [zoom, holdMs] of scenario.steps) {
        await page.evaluate(
            ({ zoom, duration }) =>
                new Promise<void>((resolve) => {
                    type MaybeMap = {
                        zoomTo: (z: number, opts: { duration: number }) => void;
                        once: (event: string, cb: () => void) => void;
                    };
                    const map = (window as unknown as { __map?: MaybeMap }).__map;
                    if (!map) {
                        resolve();
                        return;
                    }
                    map.once('moveend', () => resolve());
                    map.zoomTo(zoom, { duration });
                }),
            { zoom, duration: ZOOM_DURATION_MS },
        );
        await page.waitForTimeout(holdMs);
    }
}

test.describe('map zoom perf', () => {
    test.beforeAll(() => {
        fs.mkdirSync(TRACE_DIR, { recursive: true });
    });

    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.route('**/api/map/events*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(SYNTHETIC_EVENTS),
            });
        });
    });

    for (const scenario of SCENARIOS) {
        test(scenario.name, async ({ page }) => {
            test.setTimeout(120_000);
            await page.goto('/map');
            await settleAtZoom(page, scenario.steps[0][0]);

            if (scenario.hideLayers && scenario.hideLayers.length > 0) {
                await page.evaluate((ids) => {
                    type MaybeMap = { setLayoutProperty: (id: string, name: string, value: string) => void };
                    const map = (window as unknown as { __map?: MaybeMap }).__map;
                    if (!map) return;
                    for (const id of ids) {
                        try { map.setLayoutProperty(id, 'visibility', 'none'); } catch { /* layer may not exist */ }
                    }
                }, scenario.hideLayers);
                // Let MapLibre tear down the symbol-layer placement work and settle.
                await page.waitForTimeout(500);
            }

            // Pre-warm one zoom round-trip outside the trace so we capture
            // steady-state, not first-paint cost.
            await runZoomSequence(page, { name: 'warmup', steps: scenario.steps.slice(0, 2) });
            await settleAtZoom(page, scenario.steps[0][0]);

            // Begin CDP trace. Standard DevTools timeline category set —
            // produces a profile loadable via DevTools → Performance →
            // Load profile.
            const cdp = await page.context().newCDPSession(page);
            const traceEvents: unknown[] = [];
            cdp.on('Tracing.dataCollected', (params) => {
                for (const evt of params.value) traceEvents.push(evt);
            });
            const traceComplete = new Promise<void>((resolve) => {
                cdp.once('Tracing.tracingComplete', () => resolve());
            });
            await cdp.send('Tracing.start', {
                categories: [
                    '-*',
                    'devtools.timeline',
                    'v8.execute',
                    'disabled-by-default-devtools.timeline',
                    'disabled-by-default-devtools.timeline.frame',
                    'disabled-by-default-devtools.timeline.stack',
                    'disabled-by-default-v8.cpu_profiler',
                    'blink.user_timing',
                    'loading',
                    'latencyInfo',
                ].join(','),
                options: 'sampling-frequency=10000',
            });

            await runZoomSequence(page, scenario);

            await cdp.send('Tracing.end');
            await traceComplete;
            await cdp.detach();

            const outPath = path.join(TRACE_DIR, `${scenario.name}.json`);
            fs.writeFileSync(outPath, JSON.stringify({ traceEvents }));
            console.log(`[map-perf] wrote ${outPath} (${traceEvents.length} events)`);
        });
    }
});
