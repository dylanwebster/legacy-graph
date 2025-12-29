import { describe, it, expect } from 'vitest';
import { AssetIndexSchema } from '../../src/schemas/AssetSchema';

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