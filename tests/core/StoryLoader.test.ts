import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StoryLoader } from '../../src/core/StoryLoader';

const TEST_DIR = path.join(__dirname, 'temp_stories');

describe('StoryLoader', () => {
    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR);
        // Create dummy story with Frontmatter and Mentions
        fs.writeFileSync(path.join(TEST_DIR, 'test.md'), `---
title: "War Story"
assets: ["war.jpg"]
---
My grandpa @N_123 served with [[N_456]].`);
    });
    afterAll(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

    it('should extract metadata and mentions', async () => {
        const loader = new StoryLoader(TEST_DIR);
        const results = await loader.loadAll();
        
        expect(results.length).toBe(1);
        expect(results[0].metadata.title).toBe("War Story");
        expect(results[0].metadata.assets).toContain("war.jpg");
        
        // Mentions extraction logic
        expect(results[0].mentions).toContain("N_123");
        expect(results[0].mentions).toContain("N_456");
    });
});