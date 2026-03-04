import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const FIXTURE_SRC = path.resolve('./tests/fixtures/data');
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
