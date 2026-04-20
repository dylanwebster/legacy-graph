// tests/core/HydrationWorker.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../../src/core/GraphEngine';
import { runHydrationWorker } from '../../src/core/HydrationWorker';

const DATA_DIR = path.join(__dirname, 'temp_worker_data');
const PEOPLE_DIR = path.join(DATA_DIR, 'people');
const STORIES_DIR = path.join(DATA_DIR, 'stories');
const META_DIR = path.join(DATA_DIR, '_meta');

function writePersonYaml(id: string, first: string, last: string, parents: string[] = []) {
    const parentEntries = parents.map(pid => `    - id: "${pid}"\n      type: "biological"`).join('\n');
    const content = `version: "5.1"
id: "${id}"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "${first}"
    last: "${last}"
sex: "U"
relationships:
  parents:
${parentEntries ? parentEntries : '    []'}
events: []
assets: []
`;
    fs.writeFileSync(path.join(PEOPLE_DIR, `${id}.yaml`), content);
}

function writeStoryMd(filename: string, title: string, content: string) {
    const md = `---
title: "${title}"
date: "2023-06-15"
tags:
  - family
---

${content}
`;
    fs.writeFileSync(path.join(STORIES_DIR, filename), md);
}

describe('HydrationWorker — runHydrationWorker()', () => {
    beforeEach(() => {
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PEOPLE_DIR, { recursive: true });
        fs.mkdirSync(STORIES_DIR, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it('should load people data matching BootLoader output', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');
        writePersonYaml('N_B', 'Bob', 'Worker');

        const result = await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: false });

        expect(result.type).toBe('success');
        expect(result.people.length).toBe(2);
        expect(result.parsed).toBe(2);
        expect(result.fromCache).toBe(0);

        const ids = result.people.map(p => p.data.id).sort();
        expect(ids).toEqual(['N_A', 'N_B']);

        // Each entry should have filePath and mtime
        result.people.forEach(entry => {
            expect(entry.filePath).toBeTruthy();
            expect(entry.mtime).toBeGreaterThan(0);
            expect(Number.isInteger(entry.mtime)).toBe(true);
        });
    });

    it('should use cache for unchanged files on second run', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');
        writePersonYaml('N_B', 'Bob', 'Worker');

        // First run — builds cache (full nuclear)
        const result1 = await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: false });
        expect(result1.parsed).toBe(2);
        expect(result1.fromCache).toBe(0);

        // Second run — should use cache
        const result2 = await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: false });
        expect(result2.fromCache).toBe(2);
        expect(result2.parsed).toBe(0);
        expect(result2.people.length).toBe(2);
    });

    it('should load stories from the stories directory', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');
        writeStoryMd('story1.md', 'The Journey', 'A story about @N_A and their travels.');

        const result = await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: false });

        expect(result.stories.length).toBe(1);
        expect(result.stories[0].metadata.title).toBe('The Journey');
        expect(result.stories[0].mentions).toContain('N_A');
    });

    it('should respect forceFullRebuild flag', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');

        // First run writes cache
        await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: false });

        // Force rebuild should ignore cache
        const result = await runHydrationWorker({ rootDir: DATA_DIR, forceFullRebuild: true });
        expect(result.parsed).toBe(1);
        expect(result.fromCache).toBe(0);
    });
});

describe('GraphEngine — hydrateInBackground()', () => {
    beforeEach(() => {
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PEOPLE_DIR, { recursive: true });
        fs.mkdirSync(STORIES_DIR, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    it('should populate graph via background hydration', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');
        writePersonYaml('N_B', 'Bob', 'Worker', ['N_A']);

        const engine = new GraphEngine(DATA_DIR);
        const result = await engine.hydrateInBackground();

        expect(result.total).toBe(2);
        expect(result.parsed + result.fromCache).toBe(2);

        const graph = engine.getGraph();
        expect(graph.hasNode('N_A')).toBe(true);
        expect(graph.hasNode('N_B')).toBe(true);
        expect(graph.order).toBe(2);

        // Edges should be built
        expect(graph.size).toBeGreaterThanOrEqual(1);
    });

    it('should produce same graph state as inline hydrate()', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');
        writePersonYaml('N_B', 'Bob', 'Worker', ['N_A']);
        writeStoryMd('story1.md', 'Test Story', 'Mentions @N_A in text.');

        // Inline hydration
        const engine1 = new GraphEngine(DATA_DIR);
        await engine1.hydrate({ forceFullRebuild: true });
        const inlineOrder = engine1.getGraph().order;
        const inlineSize = engine1.getGraph().size;
        const inlineHasA = engine1.getGraph().hasNode('N_A');
        const inlineHasB = engine1.getGraph().hasNode('N_B');

        // Background hydration (fresh engine, force rebuild to avoid cache from engine1)
        const engine2 = new GraphEngine(DATA_DIR);
        await engine2.hydrateInBackground({ forceFullRebuild: true });
        const bgOrder = engine2.getGraph().order;
        const bgSize = engine2.getGraph().size;
        const bgHasA = engine2.getGraph().hasNode('N_A');
        const bgHasB = engine2.getGraph().hasNode('N_B');

        // Same node/edge counts
        expect(bgOrder).toBe(inlineOrder);
        expect(bgSize).toBe(inlineSize);
        expect(bgHasA).toBe(inlineHasA);
        expect(bgHasB).toBe(inlineHasB);
    });

    it('should track hydrationState through background hydration', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');

        const engine = new GraphEngine(DATA_DIR);

        // Before hydration: loading
        expect(engine.hydrationState).toBe('loading');

        // After background hydration: ready
        await engine.hydrateInBackground();
        expect(engine.hydrationState).toBe('ready');

        // Graph should be populated
        expect(engine.getGraph().order).toBeGreaterThan(0);
    });

    it('should write cache after background hydration', async () => {
        writePersonYaml('N_A', 'Alice', 'Worker');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrateInBackground();

        // cacheAge should be set
        expect(engine.cacheAge).not.toBeNull();

        // Cache file should exist
        const cachePath = path.join(META_DIR, '.graph-cache.json');
        expect(fs.existsSync(cachePath)).toBe(true);
    });

    it('should compute _computed relationships after background hydration', async () => {
        writePersonYaml('N_PARENT', 'Parent', 'Test');
        writePersonYaml('N_CHILD', 'Child', 'Test', ['N_PARENT']);

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrateInBackground();

        const graph = engine.getGraph();
        const parentAttrs = graph.getNodeAttributes('N_PARENT');

        // _computed should be populated
        expect(parentAttrs._computed).toBeDefined();
        expect(parentAttrs._computed.children).toContain('N_CHILD');
    });

    it('should build search index after background hydration', async () => {
        writePersonYaml('N_A', 'Searchable', 'Person');

        const engine = new GraphEngine(DATA_DIR);
        await engine.hydrateInBackground();

        const results = await engine.searchService.search('Searchable');
        expect(results.people.length).toBeGreaterThan(0);
        expect(results.people[0].id).toBe('N_A');
    });
});
