
import { AssetMetadataSchema } from '../../src/schemas/AssetSchema';
import { EventSchema } from '../../src/schemas/EventSchema';
import { describe, it, expect } from 'vitest';

describe('Schema Expansion', () => {
    describe('AssetSchema', () => {
        it('should accept name and description', () => {
            const asset = {
                id: '123',
                name: 'Grandpa',
                description: 'A photo of grandpa in the garden.',
                caption: 'Grandpa, 1950',
                date_taken: '1950-05-01',
                location: 'London'
            };
            const parsed = AssetMetadataSchema.safeParse(asset);
            expect(parsed.success).toBe(true);
            if(parsed.success) {
                expect(parsed.data.name).toBe('Grandpa');
                expect(parsed.data.description).toBe('A photo of grandpa in the garden.');
            }
        });

        it('should be valid without optional fields', () => {
             const asset = {
                id: '124'
            };
            const parsed = AssetMetadataSchema.safeParse(asset);
            expect(parsed.success).toBe(true);
        });
    });

    describe('EventSchema', () => {
        it('should parse census event', () => {
            const event = {
                type: 'census',
                date: '1901',
                sort_date: '1901-01-01',
                household_id: 'H123'
            };
            const parsed = EventSchema.safeParse(event);
            expect(parsed.success).toBe(true);
            if(parsed.success && parsed.data.type === 'census') {
                expect(parsed.data.household_id).toBe('H123');
            }
        });

         it('should parse baptism event', () => {
            const event = {
                type: 'baptism',
                date: '1900',
                sort_date: '1900-01-01',
                location: 'Church'
            };
            const parsed = EventSchema.safeParse(event);
            expect(parsed.success).toBe(true);
        });

        it('should parse occupation event', () => {
            const event = {
                type: 'occupation',
                date: '1920-1950',
                sort_date: '1920-01-01',
                title: 'Baker',
                organization: 'Bakery Inc'
            };
            const parsed = EventSchema.safeParse(event);
            expect(parsed.success).toBe(true);
            if(parsed.success && parsed.data.type === 'occupation') {
                expect(parsed.data.title).toBe('Baker');
            }
        });
        
         it('should parse education event', () => {
            const event = {
                type: 'education',
                date: '1910-1914',
                sort_date: '1910-09-01',
                institution: 'University',
                degree: 'BSc'
            };
            const parsed = EventSchema.safeParse(event);
            expect(parsed.success).toBe(true);
            if(parsed.success && parsed.data.type === 'education') {
                expect(parsed.data.degree).toBe('BSc');
            }
        });
    });
});
