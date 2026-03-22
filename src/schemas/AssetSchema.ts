import { z } from 'zod';
import { nanoid } from 'nanoid';
import { PlaceSchema } from './PlaceSchema';

// Accepts a Place object, or a legacy plain string (coerced to { name: string })
const LocationField = z.preprocess(
    (val) => { if (typeof val === 'string') return { name: val }; return val; },
    PlaceSchema,
).optional();

// Represents a single entry in _meta/assets.yaml
export const AssetMetadataSchema = z.object({
    id: z.string().default(() => nanoid()),
    name: z.string().optional(),
    description: z.string().optional(),
    caption: z.string().optional(),    // legacy — consumed by transform (caption → description)
    date: z.string().optional(),
    date_taken: z.string().optional(), // legacy — consumed by transform (date_taken → date)
    location: LocationField,
}).transform(({ caption, date_taken, ...rest }) => ({
    ...rest,
    description: rest.description ?? caption,
    date: rest.date ?? date_taken,
}));

export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

// The file itself is a dictionary: Filename -> Metadata
export const AssetIndexSchema = z.record(z.string(), AssetMetadataSchema);

export type AssetIndex = z.infer<typeof AssetIndexSchema>;
