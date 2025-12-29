import { describe, it, expect } from 'vitest';
import { EventSchema } from '../../src/schemas/EventSchema';

describe('EventSchema', () => {
    it('should validate a marriage event', () => {
        const evt = {
            id: "evt_1",
            type: "marriage",
            date: "1950",
            sort_date: "1950-06-01",
            partner_id: "N_SPOUSE",
            status: "married"
        };
        expect(EventSchema.safeParse(evt).success).toBe(true);
    });

    it('should validate an event with assets', () => {
        const evt = {
            id: "evt_2",
            type: "birth",
            date: "1920",
            sort_date: "1920-01-01",
            assets: ["birth_cert.jpg"] // Asset linking
        };
        expect(EventSchema.safeParse(evt).success).toBe(true);
    });
});