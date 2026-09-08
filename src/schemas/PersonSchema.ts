// src/schemas/PersonSchema.ts
import { z } from 'zod';
import { EventSchema } from './EventSchema';

// Schema 5.1 adds event date ranges (end_date + sort_end_date).
// 5.0 files are upgraded in-place on read; field defaults fill the new columns.
const VersionSchema = z.preprocess(
    (v) => (v === "5.0" ? "5.1" : v),
    z.literal("5.1"),
);

export const PersonSchema = z.object({
    version: VersionSchema,
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

    events: z.array(EventSchema).default([]),
    assets: z.array(z.string()).default([]),

    // Phase 3 Extensions
    scrapbook_md: z.string().default(""), // Free-form notes
    _gedcom: z.record(z.string(), z.any()).optional() // Loss-prevention bucket
});

export type Person = z.infer<typeof PersonSchema>;

export type SlimPerson = Omit<Person, 'scrapbook_md' | '_gedcom'>;

export function toSlimPerson(p: Person): SlimPerson {
    const { scrapbook_md: _scrapbook_md, _gedcom, ...slim } = p;
    return slim;
}

export interface PersonEntry {
    data: SlimPerson;
    bio: string;
    filePath: string;
    mtime: number;
    wasParsed?: boolean;
}
