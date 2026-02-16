// tests/core/GraphCache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../../src/core/GraphEngine';
import { GraphCache, CACHE_SPEC_VERSION } from '../../src/core/GraphCache';

const DATA_DIR = path.join(__dirname, 'temp_cache_data');
const PEOPLE_DIR = path.join(DATA_DIR, 'people');
const STORIES_DIR = path.join(DATA_DIR, 'stories');
const META_DIR = path.join(DATA_DIR, '_meta');
const CACHE_PATH = path.join(META_DIR, '.graph-cache.json');

function writePersonYaml(id: string, first: string, last: string) {
    const content = `version: "5.0"
id: "${id}"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "${first}"
    last: "${last}"
sex: "U"
relationships:
  parents: []
events: []
assets: []
`;
    fs.writeFileSync(path.join(PEOPLE_DIR, `${id}.yaml`), content);
}

describe('GraphCache — Tiered Binary Cache', () => {
    beforeEach(() => {
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PEOPLE_DIR, { recursive: true });
        fs.mkdirSync(STORIES_DIR, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it('should write cache file after hydration', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');
        writePersonYaml('N_B', 'Bob', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate();

        // Cache file should exist after hydration
        expect(fs.existsSync(CACHE_PATH)).toBe(true);

        // Cache should be parseable and contain both entries
        const cache = await GraphCache.load(CACHE_PATH);
        expect(cache).not.toBeNull();
        expect(cache!.spec_version).toBe(CACHE_SPEC_VERSION);
        expect(Object.keys(cache!.entries).length).toBe(2);
    });

    it('should use cache on second hydration (cache hit skips YAML parsing)', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');
        writePersonYaml('N_B', 'Bob', 'Test');

        const engine = new GraphEngine(DATA_DIR);

        // First hydration — full nuclear, writes cache
        const result1 = await engine.hydrate();
        expect(result1.parsed).toBe(2);
        expect(result1.fromCache).toBe(0);

        // Second hydration — should use cache for both files
        const result2 = await engine.hydrate();
        expect(result2.fromCache).toBe(2);
        expect(result2.parsed).toBe(0);

        // Graph should still be correct
        const graph = engine.getGraph();
        expect(graph.hasNode('N_A')).toBe(true);
        expect(graph.hasNode('N_B')).toBe(true);
        expect(graph.order).toBe(2);
    });

    it('should re-parse only stale files when mtime changes', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');
        writePersonYaml('N_B', 'Bob', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate();

        // Wait to ensure mtime changes, then modify one file
        await new Promise(r => setTimeout(r, 100));
        writePersonYaml('N_A', 'Alice', 'Updated');

        // Second hydration — N_A re-parsed (mtime changed), N_B from cache
        const result = await engine.hydrate();
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(1);
        expect(result.total).toBe(2);

        // Verify updated data is in graph
        const graph = engine.getGraph();
        const nodeData = graph.getNodeAttributes('N_A');
        expect(nodeData.data.names[0].last).toBe('Updated');
    });

    it('should do full nuclear hydration when cache is missing', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        // No cache file exists — full nuclear
        const result = await engine.hydrate();
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(0);
    });

    it('should do full nuclear hydration on spec_version mismatch', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        // Write a cache with wrong spec version
        fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(CACHE_PATH, JSON.stringify({
            spec_version: '4.0',
            created_at: new Date().toISOString(),
            entries: {}
        }));

        const engine = new GraphEngine(DATA_DIR);
        const result = await engine.hydrate();
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(0);
    });

    it('should do full nuclear hydration on corrupt cache', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        // Write corrupt (non-JSON) cache
        fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(CACHE_PATH, 'THIS IS NOT VALID JSON!!!');

        const engine = new GraphEngine(DATA_DIR);
        const result = await engine.hydrate();
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(0);
    });

    it('should parse new files added after cache was written', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate(); // Writes cache with only N_A

        // Add a new file not in cache
        writePersonYaml('N_C', 'Charlie', 'New');

        const result = await engine.hydrate();
        expect(result.parsed).toBe(1);  // Only N_C parsed
        expect(result.fromCache).toBe(1); // N_A from cache
        expect(result.total).toBe(2);

        expect(engine.getGraph().hasNode('N_C')).toBe(true);
    });

    it('should exclude deleted files from graph', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');
        writePersonYaml('N_B', 'Bob', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate(); // Cache has N_A and N_B

        // Delete N_B from disk
        fs.unlinkSync(path.join(PEOPLE_DIR, 'N_B.yaml'));

        const result = await engine.hydrate();
        expect(result.total).toBe(1); // Only N_A

        const graph = engine.getGraph();
        expect(graph.hasNode('N_A')).toBe(true);
        expect(graph.hasNode('N_B')).toBe(false);
    });

    it('should bypass cache when forceFullRebuild is true', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrate(); // Writes cache

        // Force rebuild should ignore existing cache
        const result = await engine.hydrate({ forceFullRebuild: true });
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(0);
    });

    it('should track hydrationState correctly', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        // Before first hydration
        expect(engine.hydrationState).toBe('loading');

        await engine.hydrate();
        expect(engine.hydrationState).toBe('ready');
    });

    it('should expose cacheAge after hydration', async () => {
        writePersonYaml('N_A', 'Alice', 'Test');

        const engine = new GraphEngine(DATA_DIR);
        expect(engine.cacheAge).toBeNull();

        await engine.hydrate();
        // After hydration, cacheAge should be a valid ISO timestamp
        expect(engine.cacheAge).not.toBeNull();
        const date = new Date(engine.cacheAge!);
        expect(date.getTime()).toBeGreaterThan(0);
    });
});
