#!/usr/bin/env tsx
/**
 * buildMapTiles.ts
 *
 * Downloads a world PMTiles basemap to ~/.legacy-graph/basemap.pmtiles for offline
 * use by the Map View. Mirrors the pattern used by buildGeonamesDb.ts.
 *
 * Usage:
 *   npm run map:build -- --url https://example.com/basemap.pmtiles
 *   PMTILES_URL=https://example.com/basemap.pmtiles npm run map:build
 *   npm run map:build -- --url ... --output /custom/path/basemap.pmtiles
 *
 * Recommended sources:
 *   - Protomaps daily basemap builds: https://maps.protomaps.com
 *     (you'll need to host your own or point at a Protomaps-hosted daily build URL)
 *
 * The resulting file is typically ~100-150 MB for the OpenStreetMap world build.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface Args {
    url: string | null;
    output: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    let url: string | null = process.env.PMTILES_URL ?? null;
    let output = path.join(os.homedir(), '.legacy-graph', 'basemap.pmtiles');
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--url' && argv[i + 1]) { url = argv[++i]; continue; }
        if (argv[i] === '--output' && argv[i + 1]) { output = argv[++i]; continue; }
    }
    return { url, output };
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function download(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    const total = Number(res.headers.get('content-length') ?? 0);
    const tmp = `${destPath}.download`;
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(tmp);
    let received = 0;
    let lastLog = Date.now();
    const reader = res.body.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        file.write(value);
        received += value.byteLength;
        if (Date.now() - lastLog > 1000) {
            const pct = total > 0 ? ` (${((received / total) * 100).toFixed(1)}%)` : '';
            process.stdout.write(`\r[map:build] downloaded ${formatBytes(received)}${pct}   `);
            lastLog = Date.now();
        }
    }
    file.end();
    await new Promise<void>((resolve, reject) => {
        file.on('finish', () => resolve());
        file.on('error', reject);
    });
    process.stdout.write('\n');
    await fsp.rename(tmp, destPath);
}

async function verifyPmtilesHeader(filePath: string): Promise<void> {
    const fd = await fsp.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(7);
        await fd.read(buf, 0, 7, 0);
        // PMTiles spec: first 7 bytes are "PMTiles" (0x50 0x4D 0x54 0x69 0x6C 0x65 0x73)
        if (buf.toString('utf8') !== 'PMTiles') {
            throw new Error(`Downloaded file does not have a PMTiles header (got bytes: ${buf.toString('hex')}). URL may be wrong or served HTML.`);
        }
    } finally {
        await fd.close();
    }
}

async function main() {
    const { url, output } = parseArgs();
    if (!url) {
        console.error('[map:build] --url is required (or set PMTILES_URL).');
        console.error('[map:build] Point it at a world-coverage PMTiles file (e.g. from https://maps.protomaps.com).');
        process.exit(1);
    }
    console.log(`[map:build] Downloading ${url}`);
    console.log(`[map:build] Destination: ${output}`);
    await download(url, output);
    await verifyPmtilesHeader(output);
    const stat = await fsp.stat(output);
    console.log(`[map:build] Done. ${formatBytes(stat.size)} written to ${output}`);
}

main().catch((err) => {
    console.error(`[map:build] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
