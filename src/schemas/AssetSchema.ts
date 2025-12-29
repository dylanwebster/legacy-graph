import { z } from 'zod';
import { nanoid } from 'nanoid';

// Represents a single entry in _meta/assets.yaml
export const AssetMetadataSchema = z.object({
    id: z.string().default(() => nanoid()),
    name: z.string().optional(),
    description: z.string().optional(),
    caption: z.string().optional(),
    date_taken: z.string().optional(),
    location: z.string().optional()
});

// The file itself is a dictionary: Filename -> Metadata
export const AssetIndexSchema = z.record(z.string(), AssetMetadataSchema);

export type AssetIndex = z.infer<typeof AssetIndexSchema>;