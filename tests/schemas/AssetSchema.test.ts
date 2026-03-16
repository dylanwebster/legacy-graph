import { describe, it, expect } from 'vitest';
import { AssetIndexSchema, AssetMetadataSchema } from '../../src/schemas/AssetSchema';

describe('AssetIndexSchema', () => {
    it('should validate a correct asset index', () => {
        const index = {
            "grandpa.jpg": {
                id: "A_123",
                description: "Grandpa in the war",
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

describe('AssetMetadataSchema — description field', () => {
    it('validates with description field', () => {
        const result = AssetMetadataSchema.safeParse({
            description: 'Family portrait',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBe('Family portrait');
        }
    });

    it('description is optional', () => {
        const result = AssetMetadataSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBeUndefined();
        }
    });

    it('date_taken is optional', () => {
        const result = AssetMetadataSchema.safeParse({ date_taken: '1945-06' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.date_taken).toBe('1945-06');
        }
    });
});

describe('AssetMetadataSchema — backwards-compat caption → description migration', () => {
    it('migrates legacy caption to description when description absent', () => {
        const result = AssetMetadataSchema.safeParse({ caption: 'Old caption value' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBe('Old caption value');
            // caption is consumed by transform — not in output type
        }
    });

    it('description takes precedence over caption when both present', () => {
        const result = AssetMetadataSchema.safeParse({
            description: 'New description',
            caption: 'Old caption',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBe('New description');
        }
    });

    it('migrates caption in AssetIndexSchema for legacy records', () => {
        const index = {
            "grandpa.jpg": { id: "A_123", caption: "Old photo" },
        };
        const result = AssetIndexSchema.safeParse(index);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data["grandpa.jpg"].description).toBe('Old photo');
        }
    });

    it('does not have tagged_people field', () => {
        const result = AssetMetadataSchema.safeParse({ description: 'test' });
        expect(result.success).toBe(true);
        if (result.success) {
            // tagged_people should not exist on the output
            expect('tagged_people' in result.data).toBe(false);
        }
    });
});
