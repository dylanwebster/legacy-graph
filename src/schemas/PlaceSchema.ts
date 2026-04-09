import { z } from 'zod';

export const PlaceSchema = z.object({
    name: z.string(),
    historicalName: z.string().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    countryCode: z.string().length(2).optional(),
    admin1Name: z.string().optional(),
    admin2Name: z.string().optional(),
    resolvedAt: z.string().datetime().optional(),
});

export type Place = z.infer<typeof PlaceSchema>;
