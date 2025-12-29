// tests/core/BootLoader.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BootLoader } from '../../src/core/BootLoader';

const TEST_DIR = path.join(__dirname, 'temp_data');

describe('BootLoader Integration', () => {
    // Setup: Create 10 dummy YAML files
    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR);
        for (let i = 0; i < 10; i++) {
            const content = `
version: "5.0"
id: "N_${i}xxxxx"
created: "2023-01-01T00:00:00Z"
last_modified: "2023-01-01T00:00:00Z"
names: 
  - first: "Test"
    last: "User${i}"
sex: "U"
relationships: 
  parents: []
`;
            fs.writeFileSync(path.join(TEST_DIR, `person_${i}.yaml`), content);
        }
    });

    // Cleanup
    afterAll(() => {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should load all yaml files from directory', async () => {
        const loader = new BootLoader(TEST_DIR);
        const results = await loader.loadAll();

        // Assert we loaded 10 items
        expect(results.length).toBe(10);
        // Assert schema validation passed (checking one ID)
        expect(results[0].id).toContain("N_");
    });
});
