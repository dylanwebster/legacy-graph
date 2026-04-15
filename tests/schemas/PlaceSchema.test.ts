import { describe, it, expect } from 'vitest';
import { formatPlaceDisplay, formatCoordinates } from '../../src/schemas/PlaceSchema';

describe('formatPlaceDisplay', () => {
    it('returns full hierarchical string for geocoded place', () => {
        expect(formatPlaceDisplay({
            name: 'Grizzly Flats',
            admin2Name: 'El Dorado County',
            admin1Name: 'California',
            countryCode: 'US',
        })).toBe('Grizzly Flats, El Dorado County, California, US');
    });

    it('returns name as-is when no admin fields', () => {
        expect(formatPlaceDisplay({ name: 'London' })).toBe('London');
    });

    it('appends only countryCode when no admin levels', () => {
        expect(formatPlaceDisplay({ name: 'Paris', countryCode: 'FR' })).toBe('Paris, FR');
    });

    it('skips admin2 when it matches name', () => {
        expect(formatPlaceDisplay({
            name: 'El Dorado County',
            admin2Name: 'El Dorado County',
            admin1Name: 'California',
        })).toBe('El Dorado County, California');
    });

    it('does not duplicate components already in GEDCOM full-string name', () => {
        expect(formatPlaceDisplay({
            name: 'Mountain View, Santa Clara, California, USA',
        })).toBe('Mountain View, Santa Clara, California, USA');
    });

    it('skips admin fields that are substrings of GEDCOM full-string name', () => {
        expect(formatPlaceDisplay({
            name: 'Mountain View, Santa Clara, California, USA',
            admin1Name: 'California',
            admin2Name: 'Santa Clara',
            countryCode: 'US',
        })).toBe('Mountain View, Santa Clara, California, USA');
    });

    it('appends admin1 when only admin1 is present', () => {
        expect(formatPlaceDisplay({
            name: 'Springfield',
            admin1Name: 'Illinois',
        })).toBe('Springfield, Illinois');
    });

    it('handles place with lat/lng but no admin (still just name)', () => {
        expect(formatPlaceDisplay({
            name: 'Somewhere',
            lat: 10,
            lng: 20,
        })).toBe('Somewhere');
    });

    it('skips admin1 that is substring of name but appends non-matching countryCode', () => {
        expect(formatPlaceDisplay({
            name: 'Sacramento, California',
            admin1Name: 'California',
            countryCode: 'US',
        })).toBe('Sacramento, California, US');
    });
});

describe('formatCoordinates', () => {
    it('formats N/E coordinates', () => {
        expect(formatCoordinates({ name: 'x', lat: 38.636, lng: 10.527 }))
            .toBe('38.64°N, 10.53°E');
    });

    it('formats S/W coordinates', () => {
        expect(formatCoordinates({ name: 'x', lat: -33.87, lng: -120.527 }))
            .toBe('33.87°S, 120.53°W');
    });

    it('returns null when lat is missing', () => {
        expect(formatCoordinates({ name: 'x' })).toBeNull();
    });

    it('returns null when lng is missing', () => {
        expect(formatCoordinates({ name: 'x', lat: 10 })).toBeNull();
    });

    it('handles zero coordinates', () => {
        expect(formatCoordinates({ name: 'x', lat: 0, lng: 0 }))
            .toBe('0.00°N, 0.00°E');
    });
});
