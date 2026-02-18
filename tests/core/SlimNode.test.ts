// tests/core/SlimNode.test.ts
// TDD: Slim Node Strategy (Phase 3.7.1)
// Tests written BEFORE implementation — all should fail initially.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../../src/core/GraphEngine';
import { toSlimPerson, SlimPerson } from '../../src/schemas/PersonSchema';

const DATA_DIR = path.join(__dirname, 'temp_slim_data');
const PEOPLE_DIR = path.join(DATA_DIR, 'people');
const STORIES_DIR = path.join(DATA_DIR, 'stories');

function writePersonYaml(id: string, first: string, last: string, extras: Record<string, any> = {}) {
    const scrapbook = extras.scrapbook_md ?? 'This is a scrapbook entry about ' + first;
    const gedcom = extras._gedcom ? `\n_gedcom:\n  CUSTOM_TAG: "${extras._gedcom.CUSTOM_TAG}"` : '';
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
scrapbook_md: "${scrapbook}"${gedcom}
`;
    fs.writeFileSync(path.join(PEOPLE_DIR, `${id}.yaml`), content);
}

describe('Slim Node Strategy (Phase 3.7.1)', () => {
    beforeEach(() => {
        if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
        fs.mkdirSync(PEOPLE_DIR, { recursive: true });
        fs.mkdirSync(STORIES_DIR, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
    });

    describe('toSlimPerson utility', () => {
        it('should strip scrapbook_md and _gedcom from a Person object', () => {
            const person = {
                version: '5.0' as const,
                id: 'N_test',
                created: '2023-01-01T00:00:00Z',
                last_modified: '2023-01-01T00:00:00Z',
                names: [{ first: 'Alice', last: 'Test' }],
                sex: 'F' as const,
                tags: [],
                relationships: { parents: [] },
                events: [],
                assets: [],
                scrapbook_md: 'Some long markdown text...',
                _gedcom: { CUSTOM_TAG: 'value' }
            };

            const slim = toSlimPerson(person);

            expect(slim.id).toBe('N_test');
            expect(slim.names[0].first).toBe('Alice');
            expect(slim.events).toEqual([]);
            expect(slim.relationships).toEqual({ parents: [] });
            // Heavy fields must be absent
            expect('scrapbook_md' in slim).toBe(false);
            expect('_gedcom' in slim).toBe(false);
        });
    });

    describe('In-memory graph nodes', () => {
        it('should NOT contain scrapbook_md in graph node data after hydration', async () => {
            writePersonYaml('N_A', 'Alice', 'Test', { scrapbook_md: 'Alice notes here' });

            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            const graph = engine.getGraph();
            const nodeData = graph.getNodeAttributes('N_A');
            const data = nodeData.data;

            expect(data.id).toBe('N_A');
            expect(data.names[0].first).toBe('Alice');
            // scrapbook_md must be stripped from in-memory data
            expect('scrapbook_md' in data).toBe(false);
        });

        it('should NOT contain _gedcom in graph node data after hydration', async () => {
            writePersonYaml('N_B', 'Bob', 'Test', { _gedcom: { CUSTOM_TAG: 'preserved' } });

            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            const graph = engine.getGraph();
            const nodeData = graph.getNodeAttributes('N_B');
            const data = nodeData.data;

            expect(data.id).toBe('N_B');
            // _gedcom must be stripped from in-memory data
            expect('_gedcom' in data).toBe(false);
        });

        it('should NOT contain scrapbook_md after hot-patch update', async () => {
            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            // Hot-patch a new file
            writePersonYaml('N_HP', 'HotPatch', 'Test', { scrapbook_md: 'hot patch notes' });
            const filePath = path.join(PEOPLE_DIR, 'N_HP.yaml');
            await (engine as any).handleFileUpdate(filePath);

            const graph = engine.getGraph();
            const nodeData = graph.getNodeAttributes('N_HP');
            const data = nodeData.data;

            expect(data.id).toBe('N_HP');
            expect(data.names[0].first).toBe('HotPatch');
            expect('scrapbook_md' in data).toBe(false);
            expect('_gedcom' in data).toBe(false);
        });
    });

    describe('Lazy loading from disk', () => {
        it('should provide file path lookup for person IDs', async () => {
            writePersonYaml('N_A', 'Alice', 'Test');

            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            const filePath = engine.getFilePathForPerson('N_A');
            expect(filePath).toBeDefined();
            expect(filePath!.endsWith('N_A.yaml')).toBe(true);
        });

        it('should return undefined for unknown person IDs', async () => {
            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            const filePath = engine.getFilePathForPerson('N_NONEXISTENT');
            expect(filePath).toBeUndefined();
        });

        it('should lazy-load scrapbook_md and _gedcom from disk', async () => {
            writePersonYaml('N_LL', 'Lazy', 'Load', {
                scrapbook_md: 'Detailed biography text',
                _gedcom: { CUSTOM_TAG: 'gedcom_value' }
            });

            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            // In-memory data should be slim
            const graph = engine.getGraph();
            const nodeData = graph.getNodeAttributes('N_LL');
            expect('scrapbook_md' in nodeData.data).toBe(false);

            // Lazy load should return the heavy fields
            const heavyFields = await engine.loadHeavyFields('N_LL');
            expect(heavyFields).not.toBeNull();
            expect(heavyFields!.scrapbook_md).toBe('Detailed biography text');
            expect(heavyFields!._gedcom).toBeDefined();
            expect(heavyFields!._gedcom!.CUSTOM_TAG).toBe('gedcom_value');
        });

        it('should return null for unknown person IDs on lazy load', async () => {
            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            const heavyFields = await engine.loadHeavyFields('N_NONEXISTENT');
            expect(heavyFields).toBeNull();
        });
    });

    describe('Search indexing with bio', () => {
        it('should still find people by scrapbook_md content via search', async () => {
            writePersonYaml('N_BIO', 'Biograph', 'Person', {
                scrapbook_md: 'Pioneer of theoretical computing'
            });

            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            // scrapbook_md should be stripped from graph node
            const graph = engine.getGraph();
            expect('scrapbook_md' in graph.getNodeAttributes('N_BIO').data).toBe(false);

            // But search should still find the person by bio content
            const results = await engine.searchService.search('theoretical computing');
            expect(results.people.length).toBeGreaterThan(0);
            expect(results.people[0].id).toBe('N_BIO');
        });

        it('should index bio during hot-patch and find via search', async () => {
            const engine = new GraphEngine(DATA_DIR);
            await engine.hydrate();

            // Hot-patch a new person with scrapbook_md
            writePersonYaml('N_HPBIO', 'HotPatchBio', 'Test', {
                scrapbook_md: 'Extraordinary mathematician and cryptographer'
            });
            const filePath = path.join(PEOPLE_DIR, 'N_HPBIO.yaml');
            await (engine as any).handleFileUpdate(filePath);

            // Graph data should be slim
            expect('scrapbook_md' in engine.getGraph().getNodeAttributes('N_HPBIO').data).toBe(false);

            // Search should find by bio
            const results = await engine.searchService.search('cryptographer');
            expect(results.people.length).toBeGreaterThan(0);
            expect(results.people[0].id).toBe('N_HPBIO');
        });
    });
});
