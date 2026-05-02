// Build the bundled offline Natural Earth basemap.
// Downloads NE source shapefiles once per shp, then derives N output
// GeoJSON files via mapshaper (simplify, filter-fields, optional `-points inner`
// for visually-centered label points). Output goes to client/public/basemap/.
// Sizes are checked against raw=30 MB / gzipped=6 MB budgets.
//
// Run via: npm run basemap:build
// Re-run only when refreshing to a new Natural Earth release.

import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const TMP = path.resolve('.tmp/basemap');
const OUT = path.resolve('client/public/basemap');
const NE = 'https://naciscdn.org/naturalearth';

interface InputSpec {
    /** Local key — used for the temp subdir. */
    name: string;
    zip: string;
    /** Shapefile basename inside the zip (no extension). */
    shp: string;
}

interface OutputSpec {
    /** Output file name without extension. */
    out: string;
    /** References InputSpec.name. */
    input: string;
    /** Mapshaper -simplify percent ('25%') or null to skip. */
    simplify: string | null;
    /** Final keep-fields list (applied AFTER any -points step). */
    keepFields: readonly string[];
    /** When 'inner', emit pole-of-inaccessibility label points (visually
     *  centered, guaranteed inside polygon). For polygon outputs, set null. */
    pointsMode: 'inner' | null;
}

// Country shapes upgraded to 1:10m for fidelity (Hawaii, Arctic islands).
// Populated places upgraded to 1:10m so major U.S. metros appear (the 1:50m
// `_simple` variant only ships ~243 cities; 1:10m ships ~7,300).
// States, lakes, and graticules stay 1:50m — the user-facing impact of
// upgrading admin1 is small, and 50m_lakes covers the named interior water.
const INPUTS: readonly InputSpec[] = [
    { name: 'admin0', zip: `${NE}/10m/cultural/ne_10m_admin_0_countries.zip`, shp: 'ne_10m_admin_0_countries' },
    // Two flavours of admin_1: the polygon dataset is used solely to derive
    // pole-of-inaccessibility label points; the lines dataset has only
    // *interior* state borders (no coastlines), which avoids the double-trace
    // ghost border where country-boundary and state-boundary overlap at the
    // coast (different scales = different vertex sets = visible offset).
    { name: 'admin1_polys', zip: `${NE}/10m/cultural/ne_10m_admin_1_states_provinces.zip`, shp: 'ne_10m_admin_1_states_provinces' },
    // Lines variant kept at 50m — interior state borders don't need 10m
    // fidelity (they're not compared against the country coastline at all).
    { name: 'admin1_lines', zip: `${NE}/50m/cultural/ne_50m_admin_1_states_provinces_lines.zip`, shp: 'ne_50m_admin_1_states_provinces_lines' },
    { name: 'lakes', zip: `${NE}/50m/physical/ne_50m_lakes.zip`, shp: 'ne_50m_lakes' },
    { name: 'places', zip: `${NE}/10m/cultural/ne_10m_populated_places_simple.zip`, shp: 'ne_10m_populated_places_simple' },
    { name: 'graticules', zip: `${NE}/50m/physical/ne_50m_graticules_15.zip`, shp: 'ne_50m_graticules_15' },
] as const;

const OUTPUTS: readonly OutputSpec[] = [
    // 10m countries simplified at 30% to preserve fjord/island coastlines.
    { out: 'countries', input: 'admin0', simplify: '30%', keepFields: ['NAME', 'ISO_A2'], pointsMode: null },
    // Country labels keep NE's `MIN_LABEL` so the layer can hide tiny
    // territories (Clipperton, San Marino, Andorra — MIN_LABEL ≈ 7-8) at low
    // zoom while still showing major countries early.
    { out: 'country-labels', input: 'admin0', simplify: null, keepFields: ['NAME', 'MIN_LABEL'], pointsMode: 'inner' },
    // States: line geometry from the *_lines variant (interior borders only).
    { out: 'states', input: 'admin1_lines', simplify: '15%', keepFields: [], pointsMode: null },
    // State labels: pole-of-inaccessibility points derived from the polygon
    // variant. `min_zoom` is kept so the layer can gate visibility by zoom —
    // huge admin_1s (California, Quebec) appear at low zoom, tiny ones
    // (Samoan villages, Caribbean parishes) only when zoomed in enough to
    // give them room.
    { out: 'state-labels', input: 'admin1_polys', simplify: null, keepFields: ['name', 'min_zoom'], pointsMode: 'inner' },
    { out: 'lakes', input: 'lakes', simplify: '50%', keepFields: ['name'], pointsMode: null },
    { out: 'places', input: 'places', simplify: null, keepFields: ['name', 'adm0name', 'pop_max', 'rank_max'], pointsMode: null },
    { out: 'graticules', input: 'graticules', simplify: null, keepFields: [], pointsMode: null },
] as const;

const RAW_BUDGET_MB = 30;
const GZ_BUDGET_MB = 6;

async function downloadAndUnzip(input: InputSpec): Promise<string> {
    const dir = path.join(TMP, input.name);
    if (existsSync(path.join(dir, `${input.shp}.shp`))) return dir;
    await mkdir(dir, { recursive: true });
    const zipPath = path.join(dir, path.basename(input.zip));
    const res = await fetch(input.zip);
    if (!res.ok) throw new Error(`fetch ${input.zip}: ${res.status}`);
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
    const r = spawnSync('unzip', ['-o', zipPath, '-d', dir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`unzip failed for ${input.zip}`);
    return dir;
}

function mapshaperCmd(o: OutputSpec, shpPath: string, outFile: string): string[] {
    const parts: string[] = ['-i', shpPath];
    if (o.simplify) parts.push('-simplify', o.simplify, 'keep-shapes');
    if (o.pointsMode === 'inner') parts.push('-points', 'inner');
    if (o.keepFields.length > 0) parts.push('-filter-fields', [...o.keepFields].join(','));
    parts.push('-o', 'format=geojson', 'precision=0.0001', outFile);
    return parts;
}

async function buildOutput(
    o: OutputSpec,
    shpDir: string,
    inputShp: string,
): Promise<{ name: string; rawSize: number; gzSize: number }> {
    const shpPath = path.join(shpDir, `${inputShp}.shp`);
    const outFile = path.join(OUT, `${o.out}.json`);
    const args = mapshaperCmd(o, shpPath, outFile);
    const r = spawnSync('npx', ['--yes', 'mapshaper@0.6', ...args], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`mapshaper failed for ${o.out}`);
    const buf = await readFile(outFile);
    const gz = gzipSync(buf, { level: 9 });
    return { name: o.out, rawSize: buf.length, gzSize: gz.length };
}

async function main(): Promise<void> {
    if (existsSync(TMP)) await rm(TMP, { recursive: true });
    await mkdir(OUT, { recursive: true });

    const inputDirs = new Map<string, { dir: string; shp: string }>();
    for (const input of INPUTS) {
        const dir = await downloadAndUnzip(input);
        inputDirs.set(input.name, { dir, shp: input.shp });
    }

    const reports: Awaited<ReturnType<typeof buildOutput>>[] = [];
    for (const o of OUTPUTS) {
        const src = inputDirs.get(o.input);
        if (!src) throw new Error(`OutputSpec '${o.out}' references unknown input '${o.input}'`);
        reports.push(await buildOutput(o, src.dir, src.shp));
    }

    const totalRaw = reports.reduce((a, r) => a + r.rawSize, 0);
    const totalGz = reports.reduce((a, r) => a + r.gzSize, 0);
    console.log('\nLayer sizes:');
    for (const r of reports) {
        console.log(
            `  ${r.name.padEnd(16)} ${(r.rawSize / 1e6).toFixed(2)} MB raw / ${(r.gzSize / 1e6).toFixed(2)} MB gz`,
        );
    }
    console.log(
        `  TOTAL            ${(totalRaw / 1e6).toFixed(2)} MB raw / ${(totalGz / 1e6).toFixed(2)} MB gz`,
    );

    if (totalRaw > RAW_BUDGET_MB * 1e6) {
        console.error(`Raw size ${(totalRaw / 1e6).toFixed(1)} MB exceeds budget ${RAW_BUDGET_MB} MB`);
        process.exit(1);
    }
    if (totalGz > GZ_BUDGET_MB * 1e6) {
        console.error(`Gzipped size ${(totalGz / 1e6).toFixed(1)} MB exceeds budget ${GZ_BUDGET_MB} MB`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
