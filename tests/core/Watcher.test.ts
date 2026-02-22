import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GraphEngine } from '../../src/core/GraphEngine';

const TEST_DIR = path.join(__dirname, 'temp_watch_test');

describe('Watcher Integration (@parcel/watcher)', () => {
    let engine: GraphEngine;

    beforeEach(async () => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_DIR, 'people'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'stories'), { recursive: true });

        engine = new GraphEngine(TEST_DIR);
        await engine.hydrate();
    });

    afterEach(async () => {
        await engine.stopWatcher();
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should use @parcel/watcher, not chokidar', () => {
        // Migration verification: GraphEngine must use @parcel/watcher (native OS APIs)
        // instead of chokidar (which causes EMFILE errors under load).
        const sourcePath = path.resolve(__dirname, '../../src/core/GraphEngine.ts');
        const source = fs.readFileSync(sourcePath, 'utf8');
        expect(source).not.toContain("from 'chokidar'");
        expect(source).not.toContain("require('chokidar')");
        expect(source).toContain('@parcel/watcher');
    });

    it('should detect file add and hot-patch the graph', async () => {
        await engine.startWatcher();

        // Write a new person YAML
        const yamlContent = `version: "5.0"
id: "N_WATCHADD"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "Watcher"
    last: "AddTest"
sex: "M"
relationships:
  parents: []
events: []
assets: []`;

        fs.writeFileSync(path.join(TEST_DIR, 'people', 'watch_add.yaml'), yamlContent);

        // Wait for the watcher event to fire and handler to process
        await new Promise(r => setTimeout(r, 500));

        expect(engine.getGraph().hasNode('N_WATCHADD')).toBe(true);
    });

    it('should detect file change and update the graph', async () => {
        // Pre-populate a person
        const initialYaml = `version: "5.0"
id: "N_WATCHCHANGE"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "Before"
    last: "Change"
sex: "F"
relationships:
  parents: []
events: []
assets: []`;
        fs.writeFileSync(path.join(TEST_DIR, 'people', 'watch_change.yaml'), initialYaml);
        await engine.hydrate();

        await engine.startWatcher();

        // Modify the person
        const updatedYaml = initialYaml.replace('Before', 'After');
        fs.writeFileSync(path.join(TEST_DIR, 'people', 'watch_change.yaml'), updatedYaml);

        await new Promise(r => setTimeout(r, 500));

        const person = engine.getGraph().getNodeAttributes('N_WATCHCHANGE').data;
        expect(person.names[0].first).toBe('After');
    });

    it('should detect file deletion and remove node from graph', async () => {
        // Pre-populate a person
        const yamlContent = `version: "5.0"
id: "N_WATCHDEL"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "Delete"
    last: "Me"
sex: "M"
relationships:
  parents: []
events: []
assets: []`;
        fs.writeFileSync(path.join(TEST_DIR, 'people', 'watch_del.yaml'), yamlContent);
        await engine.hydrate();
        expect(engine.getGraph().hasNode('N_WATCHDEL')).toBe(true);

        await engine.startWatcher();

        // Delete the file
        fs.unlinkSync(path.join(TEST_DIR, 'people', 'watch_del.yaml'));

        await new Promise(r => setTimeout(r, 500));

        expect(engine.getGraph().hasNode('N_WATCHDEL')).toBe(false);
    });

    it('should clean up subscription on stopWatcher()', async () => {
        await engine.startWatcher();
        // Should not throw
        await engine.stopWatcher();
        // Calling again should be a no-op
        await engine.stopWatcher();
    });
});

describe('Story Watcher (Phase 3.8.5)', () => {
    let engine: GraphEngine;

    beforeEach(async () => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_DIR, 'people'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'stories'), { recursive: true });

        // Create a person for story mentions
        const personYaml = `version: "5.0"
id: "N_STORYREF"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "Story"
    last: "Subject"
sex: "M"
relationships:
  parents: []
events: []
assets: []
scrapbook_md: ""`;
        fs.writeFileSync(path.join(TEST_DIR, 'people', 'N_STORYREF.yaml'), personYaml);

        engine = new GraphEngine(TEST_DIR);
        await engine.hydrate();
    });

    afterEach(async () => {
        await engine.stopWatcher();
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should add story node and edges on handleStoryUpdate', async () => {
        const storyMd = `---
title: "Test Story"
date: "2023-01-01"
tags: []
assets: []
---

This story mentions @N_STORYREF in the text.`;

        const storyPath = path.join(TEST_DIR, 'stories', 'test-story.md');
        fs.writeFileSync(storyPath, storyMd);

        await (engine as any).handleStoryUpdate(storyPath);

        const graph = engine.getGraph();
        expect(graph.hasNode('test-story.md')).toBe(true);
        expect(graph.getNodeAttributes('test-story.md').type).toBe('story');

        // Should have a mentions edge to the person
        const edges = graph.outEdges('test-story.md');
        expect(edges.length).toBeGreaterThanOrEqual(1);
        const mentionEdge = edges.find(e => graph.getEdgeAttributes(e).type === 'mentions');
        expect(mentionEdge).toBeDefined();
        expect(graph.target(mentionEdge!)).toBe('N_STORYREF');
    });

    it('should update story node on re-processing', async () => {
        const storyMd1 = `---
title: "Original Title"
date: "2023-01-01"
tags: []
assets: []
---

Content version one.`;

        const storyPath = path.join(TEST_DIR, 'stories', 'update-story.md');
        fs.writeFileSync(storyPath, storyMd1);
        await (engine as any).handleStoryUpdate(storyPath);

        expect(engine.getGraph().getNodeAttributes('update-story.md').data.metadata.title).toBe('Original Title');

        const storyMd2 = `---
title: "Updated Title"
date: "2023-01-01"
tags: []
assets: []
---

Content version two.`;

        fs.writeFileSync(storyPath, storyMd2);
        await (engine as any).handleStoryUpdate(storyPath);

        expect(engine.getGraph().getNodeAttributes('update-story.md').data.metadata.title).toBe('Updated Title');
    });

    it('should remove story node and edges on handleStoryRemove', async () => {
        const storyMd = `---
title: "Removable Story"
date: "2023-01-01"
tags: []
assets: []
---

This mentions @N_STORYREF.`;

        const storyPath = path.join(TEST_DIR, 'stories', 'remove-story.md');
        fs.writeFileSync(storyPath, storyMd);
        await (engine as any).handleStoryUpdate(storyPath);

        expect(engine.getGraph().hasNode('remove-story.md')).toBe(true);

        (engine as any).handleStoryRemove(storyPath);

        expect(engine.getGraph().hasNode('remove-story.md')).toBe(false);
    });

    it('should index story in search on handleStoryUpdate', async () => {
        const storyMd = `---
title: "Searchable Adventure"
date: "2023-01-01"
tags: []
assets: []
---

A unique adventure story.`;

        const storyPath = path.join(TEST_DIR, 'stories', 'search-story.md');
        fs.writeFileSync(storyPath, storyMd);
        await (engine as any).handleStoryUpdate(storyPath);

        const results = await engine.searchService.search("Searchable");
        expect(results.stories.length).toBeGreaterThanOrEqual(1);
        expect(results.stories[0].id).toBe('search-story.md');
    });
});
