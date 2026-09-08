import { defineConfig } from '@playwright/test';

/**
 * Standalone config for the map zoom-perf trace harness.
 *
 *   npx playwright test --config=playwright.config.perf.ts
 *
 * Single project, single worker, no retries. Produces DevTools-compatible
 * `*.json` profiles under `tests/e2e/perf-traces/`. Open them via Chrome
 * DevTools → Performance → Load profile.
 *
 * Reuses the dev frontend if one is already running (usually the case while
 * actively iterating on perf). Otherwise spawns one — but the backend on
 * port 3000 is *not* started here, because the harness stubs `/api/map/events`
 * via page.route, so no real data layer is needed.
 */
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /map-perf\.spec\.ts$/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180_000,
    use: {
        baseURL: 'http://localhost:5173',
    },
    webServer: {
        command: 'cd client && npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30_000,
    },
});
