import { describe, it, expect } from 'vitest';
import { EventSchema } from '../../src/schemas/EventSchema';

describe('EventSchema', () => {
    it('should validate a marriage event', () => {
        const marriage = {
            id: "evt_123",
            type: "marriage",
            date: "1950-06-01",
            sort_date: "1950-06-01",
            partner_id: "N_spouse123",
            status: "married"
        };
        const result = EventSchema.safeParse(marriage);
        expect(result.success).toBe(true);
    });

    it('should fail a marriage event missing a partner', () => {
        const invalid = {
            id: "evt_456",
            type: "marriage",
            date: "1950"
            // Missing partner_id
        };
        const result = EventSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });
});