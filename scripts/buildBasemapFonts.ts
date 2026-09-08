// Vendor MapLibre glyph PBFs (Open Sans Regular) into client/public/fonts/.
// The openmaptiles/fonts main branch ships TTF source + a fontnik-based
// generate.js (heavy native deps). The gh-pages branch instead carries the
// pre-built PBFs as committed files — we shallow-clone that branch and copy
// just the Regular weight. Run once per font upgrade; the resulting PBFs are
// committed to this repo so end users do not need git at install time.
//
// Run via: npm run basemap:fonts

import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TMP = path.resolve('.tmp/fonts');
const DST = path.resolve('client/public/fonts/Open Sans Regular');
const REPO = 'https://github.com/openmaptiles/fonts.git';
const BRANCH = 'gh-pages';

async function main(): Promise<void> {
    if (existsSync(TMP)) await rm(TMP, { recursive: true });
    await mkdir(path.dirname(TMP), { recursive: true });
    const r = spawnSync(
        'git',
        ['clone', '--depth', '1', '--branch', BRANCH, REPO, TMP],
        { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error(`git clone failed: ${REPO}#${BRANCH}`);
    await mkdir(DST, { recursive: true });
    const r2 = spawnSync('cp', ['-R', `${TMP}/Open Sans Regular/.`, DST], { stdio: 'inherit' });
    if (r2.status !== 0) throw new Error('cp -R failed');
    console.log(`Copied glyph PBFs from ${TMP}/Open Sans Regular to ${DST}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
