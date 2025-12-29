import { z } from 'zod';
import { nanoid } from 'nanoid';

const BaseEvent = z.object({
    id: z.string().default(() => nanoid()),
    date: z.string(), // "Bet. 1900 and 1910"
    sort_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ISO-8601
    location: z.string().optional(),
    description: z.string().optional(),
    assets: z.array(z.string()).default([]) // List of filenames/IDs
});

export const EventSchema = z.discriminatedUnion("type", [
    BaseEvent.extend({ type: z.literal("birth") }),
    BaseEvent.extend({ type: z.literal("death"), cause: z.string().optional() }),
    BaseEvent.extend({ 
        type: z.literal("marriage"),
        partner_id: z.string(),
        status: z.enum(["married", "divorced", "widowed"]).default("married")
    }),
    BaseEvent.extend({ type: z.literal("divorce"), partner_id: z.string() }),
    BaseEvent.extend({ type: z.literal("residence") }),
    BaseEvent.extend({ type: z.literal("census"), household_id: z.string().optional() }),
    BaseEvent.extend({ type: z.literal("baptism") }),
    BaseEvent.extend({ type: z.literal("burial") }),
    BaseEvent.extend({ 
        type: z.literal("occupation"), 
        title: z.string(), 
        organization: z.string().optional() 
    }),
    BaseEvent.extend({ 
        type: z.literal("education"), 
        institution: z.string(), 
        degree: z.string().optional() 
    }),
    BaseEvent.extend({ type: z.literal("generic"), title: z.string().optional() })
]);

export type LegacyEvent = z.infer<typeof EventSchema>;