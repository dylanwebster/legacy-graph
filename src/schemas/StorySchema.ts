// src/schemas/StorySchema.ts
import { z } from 'zod';
import { PlaceSchema } from './PlaceSchema';
import type { Place } from './PlaceSchema';

export const StorySchema = z.object({
    title: z.string(),
    date: z.string().optional(),
    place: z.union([
        PlaceSchema,
        z.string().transform((s): Place => ({ name: s })),
    ]).optional(),
    private: z.boolean().optional().default(false),
    people: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    assets: z.array(z.string()).default([]),
    created_at: z.string().optional(),
    modified_at: z.string().optional(),
});
// Note: Content is handled separately as the Markdown body
export type StoryMetadata = z.infer<typeof StorySchema>;

// Shape returned by GET /api/stories (list)
export interface StoryFeedItem {
    id: string;            // filename without .md
    title: string;
    date?: string;
    place?: Place;
    people: string[];      // union of metadata.people + body @mentions
    excerpt: string;       // first 280 chars of body text
    firstAsset?: string;
    private: boolean;
    created_at?: string;   // ISO 8601 — set once on POST
    modified_at?: string;  // ISO 8601 — updated on every PUT
}

// Shape returned by GET /api/stories/:id (detail)
export interface FullStory {
    id: string;
    metadata: StoryMetadata;
    content: string;
    mentions: string[];    // body-parsed @N_xxx / [[N_xxx]] mentions
}
