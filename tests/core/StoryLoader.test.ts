import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StoryLoader } from '../../src/core/StoryLoader';

const TEST_DIR = path.join(__dirname, 'temp_stories');

describe('StoryLoader', () => {
    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR);
        // Create a dummy story
        const content = `---
title: "The Great War"
date: "1914-1918"
tags: ["war", "history"]
---
My grandfather [[N_123]] served with his brother @N_456.`;
        fs.writeFileSync(path.join(TEST_DIR, 'war.md'), content);
    });

    afterAll(() => {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    });

    it('should load story and extract mentions', async () => {
        const loader = new StoryLoader(TEST_DIR);
        const stories = await loader.loadAll();

        expect(stories.length).toBe(1);
        expect(stories[0].title).toBe("The Great War");
        // It should detect both [[ID]] and @ID formats
        expect(stories[0].mentions).toContain("N_123");
        expect(stories[0].mentions).toContain("N_456");
    });
});