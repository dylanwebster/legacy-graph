import { z } from 'zod';
import { nanoid } from 'nanoid';
import { PlaceSchema, type Place } from './PlaceSchema';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const BaseEvent = z.object({
    id: z.string().default(() => nanoid()),
    date: z.string().default(''), // "Bet. 1900 and 1910" — optional, empty string when unknown
    sort_date: z.string().regex(ISO_DATE).nullable().default(null), // ISO-8601, null if unparseable or absent
    end_date: z.string().optional(), // Human-readable end of range; absent when event is a point
    sort_end_date: z.string().regex(ISO_DATE).optional(), // ISO-8601 end of range, absent when event is a point
    location: z.union([
        z.string().transform((s): Place => ({ name: s })),
        PlaceSchema,
    ]).optional(),
    site_name: z.string().optional(), // Specific building/street (church, hospital, cemetery, etc.)
    description: z.string().optional(),
    assets: z.array(z.string()).default([]) // List of filenames/IDs
});

const validDateRange = (evt: { sort_date: string | null; sort_end_date?: string }) =>
    !evt.sort_date || !evt.sort_end_date || evt.sort_end_date >= evt.sort_date;
const dateRangeMsg = { message: 'sort_end_date must be on or after sort_date', path: ['sort_end_date'] };

export const EventSchema = z.discriminatedUnion("type", [
    BaseEvent.extend({ type: z.literal("birth") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("death"), cause: z.string().optional() }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({
        type: z.literal("marriage"),
        partner_id: z.string(),
        status: z.enum(["married", "divorced", "widowed"]).default("married")
    }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("divorce"), partner_id: z.string() }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("residence") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("census"), household_id: z.string().optional() }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("baptism") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("burial") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({
        type: z.literal("occupation"),
        title: z.string(),
        organization: z.string().optional()
    }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({
        type: z.literal("education"),
        institution: z.string(),
        degree: z.string().optional()
    }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("engagement"), partner_id: z.string() }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({
        type: z.literal("military_service"),
        branch: z.string(),
        rank: z.string().optional()
    }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("immigration") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("emigration") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("adoption") }).refine(validDateRange, dateRangeMsg),
    BaseEvent.extend({ type: z.literal("generic"), title: z.string().optional() }).refine(validDateRange, dateRangeMsg),
]);

export type LegacyEvent = z.infer<typeof EventSchema>;