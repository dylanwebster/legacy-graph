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

    it('should validate an engagement event with partner_id', () => {
        const evt = {
            type: 'engagement', date: '1949', sort_date: '1949-03-15',
            partner_id: 'N_PARTNER',
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('engagement');
            expect((result.data as any).partner_id).toBe('N_PARTNER');
        }
    });

    it('should reject engagement without partner_id', () => {
        const evt = { type: 'engagement', date: '1949', sort_date: '1949-03-15' };
        expect(EventSchema.safeParse(evt).success).toBe(false);
    });

    it('should validate a military_service event with branch and rank', () => {
        const evt = {
            type: 'military_service', date: '1942', sort_date: '1942-06-01',
            branch: 'US Army', rank: 'Sergeant',
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('military_service');
            expect((result.data as any).branch).toBe('US Army');
            expect((result.data as any).rank).toBe('Sergeant');
        }
    });

    it('should reject military_service without branch', () => {
        const evt = { type: 'military_service', date: '1942', sort_date: '1942-06-01' };
        expect(EventSchema.safeParse(evt).success).toBe(false);
    });

    it('should validate military_service without optional rank', () => {
        const evt = { type: 'military_service', date: '1942', sort_date: '1942-06-01', branch: 'Navy' };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as any).rank).toBeUndefined();
        }
    });

    it('should validate an immigration event', () => {
        const evt = {
            type: 'immigration', date: '1910', sort_date: '1910-04-15',
            location: 'New York, USA',
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('immigration');
            expect(result.data.location).toEqual({ name: 'New York, USA' });
        }
    });

    it('should validate an emigration event', () => {
        const evt = {
            type: 'emigration', date: '1910', sort_date: '1910-04-15',
            location: 'Hamburg, Germany',
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('emigration');
        }
    });

    it('should validate an adoption event', () => {
        const evt = {
            type: 'adoption', date: '1955', sort_date: '1955-08-20',
            description: 'Adopted by the Smith family',
        };
        const result = EventSchema.safeParse(evt);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('adoption');
            expect(result.data.description).toBe('Adopted by the Smith family');
        }
    });

    describe('date ranges (schema 5.1)', () => {
        it('leaves end_date and sort_end_date undefined when absent', () => {
            const evt = { type: 'residence', date: '1900', sort_date: '1900-01-01' };
            const result = EventSchema.safeParse(evt);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.end_date).toBeUndefined();
                expect(result.data.sort_end_date).toBeUndefined();
            }
        });

        it('accepts a residence with both sort_date and sort_end_date', () => {
            const evt = {
                type: 'residence',
                date: '1900–1920',
                sort_date: '1900-01-01',
                end_date: '1920',
                sort_end_date: '1920-12-31',
                location: 'London',
            };
            const result = EventSchema.safeParse(evt);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.sort_end_date).toBe('1920-12-31');
                expect(result.data.end_date).toBe('1920');
            }
        });

        it('accepts absent sort_end_date', () => {
            const evt = {
                type: 'occupation', title: 'Baker',
                date: '1920', sort_date: '1920-01-01',
            };
            const result = EventSchema.safeParse(evt);
            expect(result.success).toBe(true);
        });

        it('rejects an invalid sort_end_date format', () => {
            const evt = {
                type: 'residence',
                date: '1900–1920',
                sort_date: '1900-01-01',
                sort_end_date: '1920', // not ISO
            };
            expect(EventSchema.safeParse(evt).success).toBe(false);
        });

        it('rejects sort_end_date earlier than sort_date', () => {
            const evt = {
                type: 'residence',
                date: '1920–1900',
                sort_date: '1920-01-01',
                sort_end_date: '1900-01-01',
            };
            expect(EventSchema.safeParse(evt).success).toBe(false);
        });

        it('allows sort_end_date equal to sort_date (single-day range)', () => {
            const evt = {
                type: 'residence',
                date: '1920-06-01',
                sort_date: '1920-06-01',
                sort_end_date: '1920-06-01',
            };
            expect(EventSchema.safeParse(evt).success).toBe(true);
        });

        it('accepts sort_end_date on a non-residence event type', () => {
            const evt = {
                type: 'military_service', branch: 'US Army',
                date: '1942–1945', sort_date: '1942-06-01',
                sort_end_date: '1945-09-02',
            };
            const result = EventSchema.safeParse(evt);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.sort_end_date).toBe('1945-09-02');
            }
        });
    });
});