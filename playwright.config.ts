import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // sequential — tests share backend state
    workers: 1,
    retries: 0,
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:5174',
        trace: 'on-first-retry',
    },
    webServer: [
        {
            // Port 3001 avoids colliding with a dev server running on 3000.
            // reuseExistingServer is intentionally false for the backend so E2E tests
            // always get a fresh server pointed at e2e-data, never the real data dir.
            command: 'DATA_DIR=./tests/fixtures/e2e-data PORT=3001 npm start',
            url: 'http://localhost:3001/api/system/status',
            reuseExistingServer: false,
            timeout: 30_000,
        },
        {
            command: 'cd client && npm run dev -- --port 5174',
            url: 'http://localhost:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
    ],
    globalSetup: './tests/e2e/setup.ts',
});
