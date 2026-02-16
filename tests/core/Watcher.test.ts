import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { GraphEngine } from '../../src/core/GraphEngine';

const TEST_DIR = path.join(__dirname, 'temp_watch_test');

describe('Watcher Integration', () => {
    // Setup: Create clean directories
    beforeAll(() => {
        if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
        fs.mkdirSync(path.join(TEST_DIR, 'people'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'stories'), { recursive: true });
    });

    // Cleanup
    afterAll(() => {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    // SKIP: This test causes EMFILE (too many open files) errors when run in parallel with other tests.
    // The underlying hot-patch functionality is verified by tests/core/GraphEngineHotPatch.test.ts.
    // TODO: Investigate test isolation or increase system file descriptor limits for CI.
    it.skip('should reload graph on file add', async () => new Promise<void>((resolve, reject) => {
        const engine = new GraphEngine(TEST_DIR);
        
        // We simulate the startWatcher behavior manually to control the Promise flow
        const watcher = chokidar.watch(TEST_DIR, { 
            ignoreInitial: true,
            persistent: true 
        });
        
        watcher.on('add', async (filePath) => {
            // Filter: Ignore temp files or directories, only react to our target
            if (!filePath.endsWith('test.yaml')) return;

            try {
                // FIX: Tiny delay to ensure fast-glob sees the new file 
                // (Fixes FS race condition on some OSs)
                await new Promise(r => setTimeout(r, 100));

                // Reaction
                await engine.hydrate();
                
                // Assert
                const hasNode = engine.getGraph().hasNode('N_WATCH');
                expect(hasNode).toBe(true);
                
                // Cleanup & Success
                await watcher.close();
                resolve();
            } catch (err) {
                // Catch assertion errors and fail the test properly
                await watcher.close();
                reject(err);
            }
        });

        // ACTION: Create file AFTER watcher is ready
        setTimeout(() => {
            const yamlContent = `
version: "5.0"
id: "N_WATCH"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names: 
  - first: "Watcher"
    last: "Test"
sex: "M"
relationships: 
  parents: []
events: []
assets: []
`;
            fs.writeFileSync(path.join(TEST_DIR, 'people', 'test.yaml'), yamlContent.trim());
        }, 200);
    }));
});