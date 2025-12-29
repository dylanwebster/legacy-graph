// src/schemas/StorySchema.ts
import { z } from 'zod';

export const StorySchema = z.object({
    title: z.string(),
    date: z.string().optional(),
    tags: z.array(z.string()).default([]),
    assets: z.array(z.string()).default([])
});
// Note: Content is handled separately as the Markdown body
export type StoryMetadata = z.infer<typeof StorySchema>;