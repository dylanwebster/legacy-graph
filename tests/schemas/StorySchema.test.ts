// tests/schemas/StorySchema.test.ts
import { describe, it, expect } from 'vitest';
import { StorySchema } from '../../src/schemas/StorySchema';

describe('StorySchema Validation', () => {
    it('should validate a basic story', () => {
        const story = {
            title: "Family Reunion",
            date: "1999-08-01",
            tags: ["reunion", "summer"],
            assets: ["img_1.jpg"]
        };
        const result = StorySchema.safeParse(story);
        expect(result.success).toBe(true);
    });
});