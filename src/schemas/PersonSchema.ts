// src/schemas/PersonSchema.ts
import { z } from 'zod';
import { EventSchema } from './EventSchema';

export const PersonSchema = z.object({
    version: z.literal("5.0"),
    id: z.string().startsWith("N_"), // NanoID validation
    created: z.string().datetime(),
    last_modified: z.string().datetime(),
    names: z.array(z.object({
        primary: z.boolean().optional(),
        first: z.string(),
        last: z.string(),
        nickname: z.string().optional()
    })).min(1),
    sex: z.enum(["M", "F", "I", "U"]), // Male, Female, Intersex, Unknown
    tags: z.array(z.string()).default([]),

    // STRICT DIRECTED GRAPH: Only store Upstream (Parents)
    relationships: z.object({
        parents: z.array(z.object({
            id: z.string(),
            type: z.enum(["biological", "adopted", "step", "foster"])
        })).default([])
    }),

    // Simplified for Phase 1 (Event schema would be separate in full impl)
    events: z.array(EventSchema).default([]),
    assets: z.array(z.any()).default([])
});

export type Person = z.infer<typeof PersonSchema>;
