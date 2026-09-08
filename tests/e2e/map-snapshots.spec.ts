import { test, expect, type Page } from '@playwright/test';

/**
 * Multi-zoom basemap visual-regression harness.
 *
 * Drives the map to a fixed (center, zoom) per test using the `window.__map`
 * hook exposed by MapView, then snapshots. Acts as a regression catcher for
 * Phases B-D — any future change that touches buildMapLayers, themedStyle,
 * or the basemap data files will fail these snapshots before reaching review.
 *
 * Regenerating baselines after an *intentional* visual change:
 *   npx playwright test map-snapshots --update-snapshots
 *
 * Tolerance is set to 2% pixel drift to absorb GPU/anti-aliasing variance
 * between machines without masking real regressions.
 */

interface View {
    name: string;
    center: [number, number];
    zoom: number;
}

const VIEWS: View[] = [
    { name: 'world', center: [0, 20], zoom: 1 },
    { name: 'us-california', center: [-119, 37], zoom: 5 },
    { name: 'vancouver', center: [-124, 48.5], zoom: 7 },
    { name: 'hawaii', center: [-156, 20], zoom: 6 },
    // Samoa: regression for the admin_1 pile-up that fired in this branch.
    { name: 'samoa', center: [-171, -14], zoom: 4 },
];

const THEMES = ['light', 'dark'] as const;

async function settleMap(page: Page, view: View): Promise<void> {
    // React Strict Mode double-mounts MapView in dev: a first map instance is
    // created and destroyed within ~tens of ms, then a second is created and
    // is the one we actually want to drive. Wait until `window.__map` has
    // been the SAME instance for 500ms before jumping to the target view —
    // otherwise jumpTo lands on the about-to-be-destroyed instance and the
    // screenshot captures the replacement at its default position.
    await page.evaluate(({ center, zoom }) => {
        type MaybeMap = {
            jumpTo: (opts: { center: [number, number]; zoom: number }) => void;
            loaded: () => boolean;
            areTilesLoaded: () => boolean;
            once: (event: string, cb: () => void) => void;
        };
        return new Promise<void>((resolve, reject) => {
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
                        map.jumpTo({ center, zoom });
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
        });
    }, view);
    // Final paint settle — guards against race between idle and the next frame.
    await page.waitForTimeout(300);
    // Sanity-check the map actually landed where we asked, in case the
    // strict-mode-stable settle ever regresses. A wrong-but-stable screenshot
    // would otherwise quietly become the new baseline on --update-snapshots.
    const actual = await page.evaluate(() => {
        const map = (window as unknown as { __map?: { getCenter: () => { lng: number; lat: number }; getZoom: () => number } }).__map;
        if (!map) return null;
        const c = map.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
    });
    if (
        !actual ||
        Math.abs(actual.lng - view.center[0]) > 1 ||
        Math.abs(actual.lat - view.center[1]) > 1 ||
        Math.abs(actual.zoom - view.zoom) > 0.5
    ) {
        throw new Error(`map landed at ${JSON.stringify(actual)}, expected ${JSON.stringify(view)}`);
    }
}

test.describe('map basemap snapshots', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        // Stub /api/map/events to return zero events. Empty extent.bbox short-
        // circuits MapView's fitBounds effect, so our jumpTo() is the only
        // thing that sets the viewport. Also makes the harness independent of
        // whatever fixture data the dev backend happens to be serving.
        await page.route('**/api/map/events*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    events: [],
                    extent: { minDate: null, maxDate: null, bbox: null },
                }),
            });
        });
    });

    for (const theme of THEMES) {
        for (const view of VIEWS) {
            test(`${theme} ${view.name} z${view.zoom}`, async ({ page }) => {
                // Apply theme before the SPA mounts so MapView sees the right
                // value during its first paint (no diff-style flicker).
                await page.addInitScript((t) => {
                    window.localStorage.setItem('theme', t);
                    if (t === 'dark') document.documentElement.classList.add('dark');
                    else document.documentElement.classList.remove('dark');
                }, theme);

                await page.goto('/map');
                await settleMap(page, view);

                await expect(page).toHaveScreenshot(
                    `${theme}-${view.name}-z${view.zoom}.png`,
                    // 5% drift tolerance — absorbs GPU/font/anti-aliasing
                    // variance between developer Macs without masking real
                    // basemap regressions (which typically change thousands
                    // of pixels at once: missing labels, double-traced
                    // coastlines, simplification changes, etc.).
                    { maxDiffPixelRatio: 0.05, fullPage: false },
                );
            });
        }
    }
});
