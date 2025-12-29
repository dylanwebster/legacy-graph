
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GraphEngine } from '../../src/core/GraphEngine';

const TEMP_DIR = path.join(__dirname, 'temp_hotpatch');
const PEOPLE_DIR = path.join(TEMP_DIR, 'people');
const STORIES_DIR = path.join(TEMP_DIR, 'stories');

// Helper to write a person file
async function writePerson(filename: string, id: string, name: string, parentIds: string[] = []) {
    const parents = parentIds.map(pid => ({ id: pid, type: 'biological' }));
    const content = `
version: "5.0"
id: "${id}"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names:
  - first: "${name}"
    last: "Test"
sex: "M"
relationships:
  parents: ${JSON.stringify(parents)}
`;
    await fs.writeFile(path.join(PEOPLE_DIR, filename), content);
}

describe('GraphEngine Hot-Patching', () => {
    let engine: GraphEngine;

    beforeEach(async () => {
        await fs.mkdir(PEOPLE_DIR, { recursive: true });
        await fs.mkdir(STORIES_DIR, { recursive: true });
        engine = new GraphEngine(TEMP_DIR);
        // Start without hydrating first to test dynamic adds? 
        // Or hydrate empty then add.
        await engine.hydrate();
        // Mock the search service to avoid errors if not fully set up
        // engine.searchService.rebuild = vi.fn();
        // engine.searchService.indexPerson = vi.fn();
        // engine.searchService.removePerson = vi.fn();
    });

    afterEach(async () => {
        await fs.rm(TEMP_DIR, { recursive: true, force: true });
    });

    // Note: We cannot easily test chokidar events in a unit test environment 
    // without mocking chokidar or using a real wait. 
    // Instead of testing the watcher *events*, we can test the *handlers* directly
    // by exposing them or making them public for testing, OR we use `any` cast.
    
    it('should handle adding a new file via hot-patch', async () => {
        const filePath = path.join(PEOPLE_DIR, 'new_person.yaml');
        await writePerson('new_person.yaml', 'N_NEW', 'New');

        await (engine as any).handleFileUpdate(filePath);

        const graph = engine.getGraph();
        expect(graph.hasNode('N_NEW')).toBe(true);
        expect(graph.getNodeAttributes('N_NEW').data.names[0].first).toBe('New');
    });

    it('should handle modifying an existing file via hot-patch', async () => {
        const filePath = path.join(PEOPLE_DIR, 'existing.yaml');
        await writePerson('existing.yaml', 'N_EXIST', 'Original');
        await (engine as any).handleFileUpdate(filePath); // Initial add

        expect(engine.getGraph().getNodeAttributes('N_EXIST').data.names[0].first).toBe('Original');

        // Update file content
        await writePerson('existing.yaml', 'N_EXIST', 'Updated');
        
        // Trigger Update
        await (engine as any).handleFileUpdate(filePath);

        expect(engine.getGraph().getNodeAttributes('N_EXIST').data.names[0].first).toBe('Updated');
    });

    it('should handle file deletion via hot-patch', async () => {
        const filePath = path.join(PEOPLE_DIR, 'delete_me.yaml');
        await writePerson('delete_me.yaml', 'N_DEL', 'DeleteMe');
        await (engine as any).handleFileUpdate(filePath);

        expect(engine.getGraph().hasNode('N_DEL')).toBe(true);

        // Trigger Delete
        await (engine as any).handleFileRemove(filePath);

        expect(engine.getGraph().hasNode('N_DEL')).toBe(false);
    });

    it('should update edges when parent reference changes', async () => {
        const sonPath = path.join(PEOPLE_DIR, 'son.yaml');
        const dadPath = path.join(PEOPLE_DIR, 'dad.yaml');

        await writePerson('dad.yaml', 'N_DAD', 'Dad');
        await writePerson('son.yaml', 'N_SON', 'Son', ['N_DAD']);

        await (engine as any).handleFileUpdate(dadPath);
        await (engine as any).handleFileUpdate(sonPath);

        const graph = engine.getGraph();
        expect(graph.hasEdge('N_SON', 'N_DAD')).toBe(true);

        // Change Son's parent to someone else (or remove parent)
        await writePerson('son.yaml', 'N_SON', 'Son', []); // No parents
        await (engine as any).handleFileUpdate(sonPath);

        expect(graph.hasEdge('N_SON', 'N_DAD')).toBe(false);
    });
});
