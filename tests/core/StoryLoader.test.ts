// tests/core/StoryLoader.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StoryLoader } from '../../src/core/StoryLoader';

const TEST_DIR = path.join(__dirname, 'temp_stories');

describe('StoryLoader Integration', () => {
    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR);
        // Create a dummy MD file with Frontmatter and Mentions
        const content = `---
title: "War Stories"
date: "1945"
---
My grandfather @N_123 served in the navy.
He met my grandmother [[N_456]] there.`;

        fs.writeFileSync(path.join(TEST_DIR, 'war_story.md'), content);
    });

    afterAll(() => {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should parse frontmatter and extract mentions', async () => {
        const loader = new StoryLoader(TEST_DIR);
        const stories = await loader.loadAll();

        expect(stories.length).toBe(1);
        expect(stories[0].metadata.title).toBe("War Stories");
        // Must extract both @N_ format and [[N_]] format [cite: 194]
        expect(stories[0].mentions).toContain("N_123");
        expect(stories[0].mentions).toContain("N_456");
    });
});