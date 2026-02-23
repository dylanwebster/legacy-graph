import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // sequential — tests share backend state
    retries: 0,
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    webServer: [
        {
            command: 'DATA_DIR=./tests/fixtures/e2e-data PORT=3000 npm start',
            url: 'http://localhost:3000/api/system/status',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
        {
            command: 'cd client && npm run dev',
            url: 'http://localhost:5173',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
    ],
    globalSetup: './tests/e2e/setup.ts',
});
