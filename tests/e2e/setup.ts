import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const FIXTURE_SRC = path.resolve('./tests/fixtures/data');
const E2E_PEOPLE_SRC = path.resolve('./tests/fixtures/e2e-people');
const E2E_DATA = path.resolve('./tests/fixtures/e2e-data');

export default async function globalSetup() {
    // Fresh copy of fixture data for each e2e run
    if (fs.existsSync(E2E_DATA)) {
        fs.rmSync(E2E_DATA, { recursive: true, force: true });
    }
    fs.mkdirSync(E2E_DATA, { recursive: true });

    // Copy fixture dirs (people, stories, _meta) — skip .git
    for (const entry of ['people', 'stories', '_meta']) {
        const src = path.join(FIXTURE_SRC, entry);
        const dst = path.join(E2E_DATA, entry);
        if (fs.existsSync(src)) {
            fs.cpSync(src, dst, { recursive: true });
        } else {
            fs.mkdirSync(dst, { recursive: true });
        }
    }

    // Copy e2e-only fixture people (stable IDs referenced by e2e tests, kept
    // separate from tests/fixtures/data/people/ which unit tests modify at will).
    if (fs.existsSync(E2E_PEOPLE_SRC)) {
        const dstPeople = path.join(E2E_DATA, 'people');
        fs.mkdirSync(dstPeople, { recursive: true });
        for (const f of fs.readdirSync(E2E_PEOPLE_SRC)) {
            fs.copyFileSync(path.join(E2E_PEOPLE_SRC, f), path.join(dstPeople, f));
        }
    }

    // Delete stale cache files — these accumulate person IDs from past runs and
    // cause FlexSearch to return stale results. They will be rebuilt by the server.
    for (const cacheFile of ['.search-index.json', '.graph-cache.json', '.geocode-cache.json']) {
        const p = path.join(E2E_DATA, '_meta', cacheFile);
        if (fs.existsSync(p)) fs.rmSync(p);
    }

    // Ensure a git repo exists (required by TransactionManager)
    if (!fs.existsSync(path.join(E2E_DATA, '.git'))) {
        execSync('git init && git add . && git commit -m "e2e fixture init" --allow-empty', {
            cwd: E2E_DATA,
            stdio: 'pipe',
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'E2E',
                GIT_AUTHOR_EMAIL: 'e2e@test',
                GIT_COMMITTER_NAME: 'E2E',
                GIT_COMMITTER_EMAIL: 'e2e@test',
            },
        });
    }

    console.log('[e2e setup] e2e-data dir ready:', E2E_DATA);
}

// Invoked directly via `tsx tests/e2e/setup.ts` (the test:e2e npm script runs
// this before Playwright starts its webServers, so the data directory is ready
// before the backend attempts hydration).
globalSetup().catch(err => { console.error(err); process.exit(1); });
