import { defineConfig } from '@playwright/test';

/**
 * Visual-snapshot config for the basemap regression harness.
 *
 * Unlike playwright.config.ts (functional E2E), this config does NOT manage
 * its own backend/frontend processes. It assumes the dev servers are already
 * running locally — the harness only verifies the rendered basemap, which is
 * served entirely by Vite at /basemap/* and /fonts/*. The Fastify backend on
 * :3000 is needed only because /api/map/events is fetched on /map mount;
 * any non-error response is sufficient for the basemap to render.
 *
 * Run the harness:
 *   npm start                                          # backend on :3000
 *   cd client && npm run dev                           # vite on :5173
 *   npx playwright test --config=playwright.config.snapshots.ts
 *
 * Regenerate baselines after an intentional visual change:
 *   npx playwright test --config=playwright.config.snapshots.ts --update-snapshots
 */
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /map-snapshots\.spec\.ts$/,
    workers: 1,
    timeout: 60_000,
    // Drop Playwright's default "-{platform}" suffix on snapshot files so we
    // commit one set of baselines, not one per OS. Snapshots are intentionally
    // generated on macOS only for now; if we ever add a Linux CI runner with
    // its own GPU stack we'll revisit and either generate per-platform or run
    // visual checks only on the canonical OS.
    snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
    },
});
