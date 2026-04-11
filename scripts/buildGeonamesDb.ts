#!/usr/bin/env tsx
/**
 * buildGeonamesDb.ts
 *
 * Downloads GeoNames data dumps and builds an offline SQLite database
 * with FTS5 full-text search optimized for genealogy place lookups.
 *
 * Usage:
 *   npm run geonames:build
 *   npm run geonames:build -- --output ~/.legacy-graph/geonames.db
 *   npm run geonames:build -- --cache-dir /tmp/geonames-cache
 *
 * Data sources:
 *   - allCountries.zip  (~330MB download, ~1.4GB uncompressed)
 *   - alternateNamesV2.zip (~250MB download)
 *
 * The resulting SQLite database is ~800MB–1.2GB depending on filters.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { execSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';

// ─── Configuration ──────────────────────────────────────────────────────────

const GEONAMES_BASE = 'https://download.geonames.org/export/dump';
const FILES = {
    allCountries: 'allCountries.zip',
    alternateNames: 'alternateNamesV2.zip',
    countryInfo: 'countryInfo.txt',
};

// Feature classes/codes to include (genealogy-relevant)
// P.* — all populated places (cities, towns, villages, historical settlements)
// A.ADM1–ADM2 — administrative divisions (states, counties; used for admin name lookups)
// ADM3/ADM4 excluded — too granular, adds noise without value for genealogy
// S.* excluded entirely — structures (churches, cemeteries, castles) add noise
const ALLOWED_FEATURE_CLASSES = new Set(['P', 'A']);
const ALLOWED_A_CODES = new Set(['ADM1', 'ADM2']);
// Language codes to keep in alternate names (genealogy-relevant European languages + English)
const ALLOW_LANG = new Set([
    'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'no', 'da',
    'fi', 'hu', 'cs', 'sk', 'ro', 'uk', 'lt', 'lv', 'et', 'hr', 'sr',
    'bg', 'el', 'ga', 'cy', 'gd',
]);
// Pseudo-language codes to always skip (not real names)
const SKIP_LANG = new Set(['link', 'wkdt', 'post', 'iata', 'icao', 'faac', 'fr_1793', 'abbr']);

const BATCH_SIZE = 10_000;

// ─── CLI Args ───────────────────────────────────────────────────────────────

function parseArgs(): { output: string; cacheDir: string } {
    const args = process.argv.slice(2);
    let output = path.join(os.homedir(), '.legacy-graph', 'geonames.db');
    let cacheDir = path.join(os.tmpdir(), 'geonames-download-cache');

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--output' && args[i + 1]) {
            output = path.resolve(args[++i]);
        } else if (args[i] === '--cache-dir' && args[i + 1]) {
            cacheDir = path.resolve(args[++i]);
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: tsx scripts/buildGeonamesDb.ts [options]

Options:
  --output <path>     Output SQLite database path (default: ~/.legacy-graph/geonames.db)
  --cache-dir <path>  Directory for downloaded files (default: /tmp/geonames-download-cache)
  -h, --help          Show this help
`);
            process.exit(0);
        }
    }

    return { output, cacheDir };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function shouldIncludePlace(featureClass: string, featureCode: string): boolean {
    if (featureClass === 'P') return true; // All populated places
    if (featureClass === 'A') return ALLOWED_A_CODES.has(featureCode);
    return false;
}

async function downloadFile(url: string, dest: string): Promise<void> {
    if (fs.existsSync(dest)) {
        console.log(`  ✓ Cached: ${path.basename(dest)}`);
        return;
    }
    console.log(`  ↓ Downloading ${path.basename(dest)}...`);
    // Use curl for progress display and resume support
    execSync(`curl -L -o "${dest}" --progress-bar "${url}"`, { stdio: 'inherit' });
}

async function unzipFile(zipPath: string, destDir: string, expectedFile: string): Promise<string> {
    const outPath = path.join(destDir, expectedFile);
    if (fs.existsSync(outPath)) {
        console.log(`  ✓ Already extracted: ${expectedFile}`);
        return outPath;
    }
    console.log(`  ↗ Extracting ${expectedFile}...`);
    execSync(`unzip -o -d "${destDir}" "${zipPath}" "${expectedFile}"`, { stdio: 'pipe' });
    return outPath;
}

function createSchema(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS geonames (
            geonameid INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            feature_class TEXT NOT NULL,
            feature_code TEXT NOT NULL,
            country_code TEXT,
            admin1 TEXT,
            admin2 TEXT,
            population INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS admin1_names (
            country_code TEXT NOT NULL,
            admin1_code TEXT NOT NULL,
            name TEXT NOT NULL,
            geonameid INTEGER NOT NULL,
            PRIMARY KEY (country_code, admin1_code)
        );

        CREATE TABLE IF NOT EXISTS admin2_names (
            country_code TEXT NOT NULL,
            admin1_code TEXT NOT NULL,
            admin2_code TEXT NOT NULL,
            name TEXT NOT NULL,
            geonameid INTEGER NOT NULL,
            PRIMARY KEY (country_code, admin1_code, admin2_code)
        );

        CREATE TABLE IF NOT EXISTS alternate_names (
            id INTEGER PRIMARY KEY,
            geonameid INTEGER NOT NULL,
            name TEXT NOT NULL,
            is_historic INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_altnames_geonameid ON alternate_names(geonameid);

        CREATE VIRTUAL TABLE IF NOT EXISTS names_fts USING fts5(
            name,
            tokenize = 'unicode61 remove_diacritics 2',
            content='',
            columnsize=0
        );

        CREATE TABLE IF NOT EXISTS fts_map (
            rowid INTEGER PRIMARY KEY,
            geonameid INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS countries (
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(code, name)
        );

        CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
}

// ─── Import Functions ───────────────────────────────────────────────────────

async function importAllCountries(db: DatabaseSync, tsvPath: string): Promise<{ placeCount: number; validIds: Set<number>; adminIds: Set<number> }> {
    console.log('\n[2/5] Importing allCountries.txt...');

    const insertPlace = db.prepare(
        'INSERT OR IGNORE INTO geonames VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertFts = db.prepare(
        'INSERT INTO names_fts (rowid, name) VALUES (?, ?)'
    );
    const insertFtsMap = db.prepare(
        'INSERT INTO fts_map (rowid, geonameid, source_type, name) VALUES (?, ?, ?, ?)'
    );
    const insertAdmin1 = db.prepare(
        'INSERT OR IGNORE INTO admin1_names VALUES (?, ?, ?, ?)'
    );
    const insertAdmin2 = db.prepare(
        'INSERT OR IGNORE INTO admin2_names VALUES (?, ?, ?, ?, ?)'
    );

    const validIds = new Set<number>();
    const adminIds = new Set<number>();
    let placeCount = 0;
    let lineCount = 0;
    let ftsRowId = 0;

    const stream = fs.createReadStream(tsvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let batch: Array<() => void> = [];

    const flushBatch = () => {
        if (batch.length === 0) return;
        db.exec('BEGIN TRANSACTION');
        for (const fn of batch) fn();
        db.exec('COMMIT');
        batch = [];
    };

    for await (const line of rl) {
        lineCount++;
        if (lineCount % 1_000_000 === 0) {
            process.stdout.write(`  ${(lineCount / 1_000_000).toFixed(0)}M lines processed, ${placeCount} places kept\r`);
        }

        const cols = line.split('\t');
        if (cols.length < 19) continue;

        const featureClass = cols[6];
        const featureCode = cols[7];

        if (!ALLOWED_FEATURE_CLASSES.has(featureClass)) continue;
        if (!shouldIncludePlace(featureClass, featureCode)) continue;

        const geonameid = parseInt(cols[0], 10);
        const name = cols[1];
        const asciiname = cols[2];
        const lat = parseFloat(cols[4]);
        const lng = parseFloat(cols[5]);
        const countryCode = cols[8] || null;
        const admin1 = cols[10] || null;
        const admin2 = cols[11] || null;
        const population = parseInt(cols[14], 10) || 0;

        if (isNaN(geonameid) || isNaN(lat) || isNaN(lng)) continue;

        validIds.add(geonameid);
        placeCount++;

        // Track admin geonameids for restricting alternate_names table
        if (featureCode === 'ADM1' || featureCode === 'ADM2') {
            adminIds.add(geonameid);
        }

        // Capture ftsRowId in closure
        const currentFtsRowId = ++ftsRowId;
        let asciiFtsRowId: number | null = null;
        if (asciiname && asciiname !== name) {
            asciiFtsRowId = ++ftsRowId;
        }

        batch.push(() => {
            // Insert into geonames table (all places including ADM1/ADM2)
            insertPlace.run(geonameid, name, lat, lng, featureClass, featureCode, countryCode, admin1, admin2, population);

            // Insert into admin lookup tables
            if (featureCode === 'ADM1' && countryCode && admin1) {
                insertAdmin1.run(countryCode, admin1, name, geonameid);
            } else if (featureCode === 'ADM2' && countryCode && admin1 && admin2) {
                insertAdmin2.run(countryCode, admin1, admin2, name, geonameid);
            }

            // Insert into contentless FTS + companion map
            insertFts.run(currentFtsRowId, name);
            insertFtsMap.run(currentFtsRowId, geonameid, 'primary', name);

            // Also index ASCII name if it differs
            if (asciiFtsRowId !== null) {
                insertFts.run(asciiFtsRowId, asciiname);
                insertFtsMap.run(asciiFtsRowId, geonameid, 'alternate', asciiname);
            }
        });

        if (batch.length >= BATCH_SIZE) {
            flushBatch();
        }
    }
    flushBatch();

    console.log(`  ✓ Imported ${placeCount.toLocaleString()} places from ${lineCount.toLocaleString()} lines`);
    return { placeCount, validIds, adminIds };
}

async function importAlternateNames(
    db: DatabaseSync,
    tsvPath: string,
    validIds: Set<number>,
    adminIds: Set<number>,
    ftsRowIdStart: number,
): Promise<{ altCount: number; ftsRowId: number }> {
    console.log('\n[3/5] Importing alternateNamesV2.txt...');

    // alternate_names table only stores rows for admin geonameids (used for admin name matching)
    const insertAlt = db.prepare(
        'INSERT OR IGNORE INTO alternate_names VALUES (?, ?, ?, ?)'
    );
    const insertFts = db.prepare(
        'INSERT INTO names_fts (rowid, name) VALUES (?, ?)'
    );
    const insertFtsMap = db.prepare(
        'INSERT INTO fts_map (rowid, geonameid, source_type, name) VALUES (?, ?, ?, ?)'
    );

    let altCount = 0;
    let lineCount = 0;
    let ftsRowId = ftsRowIdStart;

    const stream = fs.createReadStream(tsvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let batch: Array<() => void> = [];

    const flushBatch = () => {
        if (batch.length === 0) return;
        db.exec('BEGIN TRANSACTION');
        for (const fn of batch) fn();
        db.exec('COMMIT');
        batch = [];
    };

    for await (const line of rl) {
        lineCount++;
        if (lineCount % 1_000_000 === 0) {
            process.stdout.write(`  ${(lineCount / 1_000_000).toFixed(0)}M lines processed, ${altCount} names kept\r`);
        }

        const cols = line.split('\t');
        if (cols.length < 4) continue;

        const altId = parseInt(cols[0], 10);
        const geonameid = parseInt(cols[1], 10);
        const lang = cols[2] || null;
        const altName = cols[3];

        if (isNaN(altId) || isNaN(geonameid)) continue;
        if (!altName || !altName.trim()) continue;
        if (lang && SKIP_LANG.has(lang)) continue;
        if (!validIds.has(geonameid)) continue;

        // cols[6] = isColloquial, cols[7] = isHistoric
        const isHistoric = cols[7] === '1' ? 1 : 0;

        // Language filter: keep null/empty, allowed languages, and historic names
        if (lang && !ALLOW_LANG.has(lang) && !isHistoric) continue;

        altCount++;
        const sourceType = isHistoric ? 'historic' : 'alternate';
        const isAdmin = adminIds.has(geonameid);
        const currentFtsRowId = ++ftsRowId;

        batch.push(() => {
            // Only store in alternate_names table if it's an admin geonameid
            // (admin alternate names are needed for searchFiltered qualifier matching)
            if (isAdmin) {
                insertAlt.run(altId, geonameid, altName, isHistoric);
            }
            // Always index in FTS for search
            insertFts.run(currentFtsRowId, altName);
            insertFtsMap.run(currentFtsRowId, geonameid, sourceType, altName);
        });

        if (batch.length >= BATCH_SIZE) {
            flushBatch();
        }
    }
    flushBatch();

    console.log(`  ✓ Imported ${altCount.toLocaleString()} alternate names from ${lineCount.toLocaleString()} lines`);
    return { altCount, ftsRowId };
}

async function importCountryInfo(db: DatabaseSync, tsvPath: string): Promise<number> {
    console.log('\n[4/5] Importing countryInfo.txt...');

    const insertCountry = db.prepare(
        'INSERT OR IGNORE INTO countries VALUES (?, ?)'
    );
    // Look up alternate names for a country geonameid from fts_map
    // (alternate_names table only has admin geonameids; countries may not be there)
    const altNamesQuery = db.prepare(
        'SELECT DISTINCT name FROM fts_map WHERE geonameid = ? AND source_type IN (\'alternate\', \'historic\')'
    );

    let nameCount = 0;

    // Read the small countryInfo file synchronously to avoid stream locking issues
    const content = fs.readFileSync(tsvPath, 'utf8');
    db.exec('BEGIN TRANSACTION');
    for (const line of content.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const cols = line.split('\t');
        if (cols.length < 17) continue;

        const code = cols[0]; // ISO 2-letter code
        const name = cols[4]; // Country name
        const geonameid = parseInt(cols[16], 10); // GeoNames ID for the country
        if (!code || !name) continue;

        // Insert official name
        insertCountry.run(code, name);
        nameCount++;

        // Insert alternate English names from the alternate_names table
        if (!isNaN(geonameid)) {
            const altRows = altNamesQuery.all(geonameid) as any[];
            for (const row of altRows) {
                if (row.name && row.name !== name) {
                    insertCountry.run(code, row.name);
                    nameCount++;
                }
            }
        }
    }
    db.exec('COMMIT');

    console.log(`  ✓ Imported ${nameCount} country names`);
    return nameCount;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const startTime = Date.now();
    const { output, cacheDir } = parseArgs();

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║       GeoNames SQLite Database Builder           ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`\n  Output:    ${output}`);
    console.log(`  Cache:     ${cacheDir}`);

    // Ensure directories exist
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.mkdir(cacheDir, { recursive: true });

    // Step 1: Download
    console.log('\n[1/5] Downloading GeoNames data...');
    const allCountriesZip = path.join(cacheDir, FILES.allCountries);
    const altNamesZip = path.join(cacheDir, FILES.alternateNames);
    const countryInfoPath = path.join(cacheDir, FILES.countryInfo);
    await downloadFile(`${GEONAMES_BASE}/${FILES.allCountries}`, allCountriesZip);
    await downloadFile(`${GEONAMES_BASE}/${FILES.alternateNames}`, altNamesZip);
    await downloadFile(`${GEONAMES_BASE}/${FILES.countryInfo}`, countryInfoPath);

    // Extract
    const allCountriesTsv = await unzipFile(allCountriesZip, cacheDir, 'allCountries.txt');
    const altNamesTsv = await unzipFile(altNamesZip, cacheDir, 'alternateNamesV2.txt');

    // Remove existing DB for clean build
    if (fs.existsSync(output)) {
        await fsp.unlink(output);
        console.log('  ✓ Removed existing database');
    }

    // Create DB and schema
    const db = new DatabaseSync(output);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=OFF');  // Speed — safe since we're building from scratch
    db.exec('PRAGMA cache_size=-512000'); // 512MB cache
    createSchema(db);

    // Step 2: Import allCountries (also populates admin lookup tables)
    const { placeCount, validIds, adminIds } = await importAllCountries(db, allCountriesTsv);

    // Track the FTS rowid counter (importAllCountries uses sequential rowids)
    // We need to count how many FTS entries were created to continue the sequence
    const ftsCountResult = db.prepare('SELECT MAX(rowid) as maxRowId FROM fts_map').get() as any;
    const ftsRowIdAfterPlaces = ftsCountResult?.maxRowId ?? 0;

    // Add country geonameids to validIds so their alternate names get imported
    const countryContent = fs.readFileSync(countryInfoPath, 'utf8');
    for (const line of countryContent.split('\n')) {
        if (line.startsWith('#') || !line.trim()) continue;
        const cols = line.split('\t');
        if (cols.length >= 17) {
            const gid = parseInt(cols[16], 10);
            if (!isNaN(gid)) validIds.add(gid);
        }
    }

    // Step 3: Import alternate names
    const { altCount } = await importAlternateNames(db, altNamesTsv, validIds, adminIds, ftsRowIdAfterPlaces);

    // Step 4: Import country info (uses fts_map for country aliases)
    await importCountryInfo(db, countryInfoPath);

    // Step 5: Optimize
    console.log('\n[5/5] Optimizing...');
    // No index on fts_map.geonameid — queries always enter via FTS rowid, not geonameid
    db.exec("INSERT INTO names_fts(names_fts) VALUES('optimize')");
    console.log('  ✓ FTS index optimized');

    // Write metadata
    const now = new Date().toISOString();
    const metaInsert = db.prepare('INSERT OR REPLACE INTO db_meta VALUES (?, ?)');
    metaInsert.run('version', '2.0');
    metaInsert.run('built_at', now);
    metaInsert.run('place_count', String(placeCount));
    metaInsert.run('alt_name_count', String(altCount));

    // Compact the database — checkpoint WAL and vacuum
    console.log('  ⊙ Compacting database...');
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec('VACUUM');
    console.log('  ✓ Database compacted');

    db.close();

    // Report
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const fileSize = fs.statSync(output).size;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);

    console.log('\n════════════════════════════════════════════════════');
    console.log(`  ✓ Database built successfully!`);
    console.log(`  Places:         ${placeCount.toLocaleString()}`);
    console.log(`  Alternate names: ${altCount.toLocaleString()}`);
    console.log(`  File size:      ${sizeMB} MB`);
    console.log(`  Time:           ${elapsed}s`);
    console.log(`  Path:           ${output}`);
    console.log('════════════════════════════════════════════════════');
    console.log(`\nTo use: set GEONAMES_DB=${output} in your .env file`);
}

main().catch(err => {
    console.error('\n[ERROR]', err);
    process.exit(1);
});
