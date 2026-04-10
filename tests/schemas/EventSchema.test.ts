import { describe, it, expect } from 'vitest';
import { EventSchema } from '../../src/schemas/EventSchema';
import { PlaceSchema } from '../../src/schemas/PlaceSchema';

describe('PlaceSchema', () => {
    it('should validate a full Place object', () => {
        const place = {
            name: 'London',
            historicalName: 'Londinium',
            lat: 51.5074,
            lng: -0.1278,
            countryCode: 'GB',
            resolvedAt: '2024-01-01T00:00:00.000Z',
        };
        const result = PlaceSchema.safeParse(place);
        expect(result.success).toBe(true);
    });

    it('should validate a minimal Place object with only name', () => {
        const result = PlaceSchema.safeParse({ name: 'London' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('London');
        }
    });

    it('should reject lat > 90', () => {
        const result = PlaceSchema.safeParse({ name: 'Bad', lat: 91 });
        expect(result.success).toBe(false);
    });

    it('should reject lng > 180', () => {
        const result = PlaceSchema.safeParse({ name: 'Bad', lng: 181 });
        expect(result.success).toBe(false);
    });

    it('should reject countryCode longer than 2 characters', () => {
        const result = PlaceSchema.safeParse({ name: 'Bad', countryCode: 'GBR' });
        expect(result.success).toBe(false);
    });

    it('historicalName round-trips through Zod', () => {
        const result = PlaceSchema.safeParse({ name: 'Kaliningrad', historicalName: 'Königsberg' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.historicalName).toBe('Königsberg');
        }
    });
});

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

    it('should coerce location string to Place object', () => {
        const evt = { type: 'birth', date: '1900', sort_date: '1900-01-01', location: 'London' };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.location).toEqual({ name: 'London' });
        }
    });

    it('should accept a Place object for location without wrapping', () => {
        const evt = {
            type: 'birth', date: '1900', sort_date: '1900-01-01',
            location: { name: 'London', lat: 51.5074, lng: -0.1278, countryCode: 'GB' }
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.location).toMatchObject({ name: 'London', lat: 51.5074 });
        }
    });

    it('should produce undefined for absent location field', () => {
        const evt = { type: 'birth', date: '1900', sort_date: '1900-01-01' };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.location).toBeUndefined();
        }
    });

    it('site_name round-trips through schema', () => {
        const evt = {
            type: 'birth', date: '1920', sort_date: '1920-01-01',
            site_name: "St. Mary's Hospital"
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.site_name).toBe("St. Mary's Hospital");
        }
    });

    it('event without site_name remains valid', () => {
        const evt = { type: 'burial', date: '1980', sort_date: '1980-03-15' };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.site_name).toBeUndefined();
        }
    });
});