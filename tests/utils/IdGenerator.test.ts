// tests/utils/IdGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { generatePersonId } from '../../src/utils/idGenerator';

describe('generatePersonId', () => {
    it('should produce an ID that starts with N_', () => {
        const id = generatePersonId({ names: [{ first: 'John', last: 'Doe', primary: true }] });
        expect(id).toMatch(/^N_/);
    });

    it('should include slugified first and last name', () => {
        const id = generatePersonId({ names: [{ first: 'Johann', last: 'Bach', primary: true }] });
        expect(id).toContain('johann');
        expect(id).toContain('bach');
    });

    it('should include birth year when birth event present', () => {
        const id = generatePersonId({
            names: [{ first: 'Johann', last: 'Bach', primary: true }],
            events: [{ type: 'birth', date: '1685', sort_date: '1685-01-01' }]
        });
        expect(id).toContain('1685');
    });

    it('should strip diacritics and special characters', () => {
        const id = generatePersonId({ names: [{ first: 'José', last: 'Müller', primary: true }] });
        expect(id).not.toContain('é');
        expect(id).not.toContain('ü');
        expect(id).toContain('jose');
        expect(id).toContain('muller');
    });

    it('should end with 8-char alphanumeric nanoid for uniqueness', () => {
        const id = generatePersonId({ names: [{ first: 'Test', last: 'Person', primary: true }] });
        // Last segment should be 8 alphanumeric characters
        const parts = id.split('-');
        const lastPart = parts[parts.length - 1];
        expect(lastPart).toMatch(/^[a-z0-9]{8}$/);
    });

    it('should produce different IDs on each call for same person', () => {
        const person = { names: [{ first: 'John', last: 'Doe', primary: true }] };
        const id1 = generatePersonId(person);
        const id2 = generatePersonId(person);
        expect(id1).not.toBe(id2);
    });

    it('should fall back to "unknown" for missing names', () => {
        const id = generatePersonId({ names: [] });
        expect(id).toContain('unknown');
    });

    it('should work without events (no birth year)', () => {
        const id = generatePersonId({ names: [{ first: 'Jane', last: 'Smith', primary: true }] });
        expect(id).toMatch(/^N_jane-smith-[a-z0-9]{8}$/);
    });

    it('should truncate prefix to max 24 chars before nanoid', () => {
        const id = generatePersonId({
            names: [{ first: 'Bartholomew', last: 'Featherstonehaugh', primary: true }],
            events: [{ type: 'birth', date: '1850', sort_date: '1850-01-01' }]
        });
        // Format: N_{prefix}-{nanoid8}
        const withoutPrefix = id.slice(2); // strip "N_"
        const lastDashIdx = withoutPrefix.lastIndexOf('-');
        const prefix = withoutPrefix.slice(0, lastDashIdx);
        expect(prefix.length).toBeLessThanOrEqual(24);
    });
});
