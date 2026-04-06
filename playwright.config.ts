import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // sequential — tests share backend state
    workers: 1,
    retries: 0,
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    webServer: [
        {
            // reuseExistingServer: false ensures E2E tests never accidentally run
            // against a dev server pointing at real data. If port 3000 is already
            // occupied (e.g. the dev server is running), Playwright will throw a
            // clear error — stop the dev server before running e2e tests.
            // NOTE: setup.ts is run as a pre-script (via package.json test:e2e) so
            // the data directory is always ready before this webServer starts.
            command: 'DATA_DIR=./tests/fixtures/e2e-data PORT=3000 npm start',
            url: 'http://localhost:3000/api/system/status',
            reuseExistingServer: false,
            timeout: 90_000,
        },
        {
            command: 'cd client && npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
    ],
});
