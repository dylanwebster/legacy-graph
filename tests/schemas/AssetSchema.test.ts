import { describe, it, expect } from 'vitest';
import { AssetIndexSchema, AssetMetadataSchema } from '../../src/schemas/AssetSchema';

describe('AssetIndexSchema', () => {
    it('should validate a correct asset index', () => {
        const index = {
            "grandpa.jpg": {
                id: "A_123",
                caption: "Grandpa in the war",
                date_taken: "1945",
                location: "Berlin"
            },
            "doc.pdf": {
                id: "A_456"
            }
        };
        const result = AssetIndexSchema.safeParse(index);
        expect(result.success).toBe(true);
    });
});

describe('AssetMetadataSchema — tagged_people', () => {
    it('validates with tagged_people array', () => {
        const result = AssetMetadataSchema.safeParse({
            caption: 'Family portrait',
            tagged_people: ['N_john-doe-1920-abc12345'],
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.tagged_people).toEqual(['N_john-doe-1920-abc12345']);
        }
    });

    it('defaults tagged_people to [] when absent', () => {
        const result = AssetMetadataSchema.safeParse({ caption: 'Photo' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.tagged_people).toEqual([]);
        }
    });

    it('defaults tagged_people to [] when field is missing from existing records', () => {
        const index = {
            "grandpa.jpg": { id: "A_123", caption: "Old photo" },
        };
        const result = AssetIndexSchema.safeParse(index);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data["grandpa.jpg"].tagged_people).toEqual([]);
        }
    });
});