// tests/utils/DateParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseFuzzyDate } from '../../src/utils/dateParser';

describe('Fuzzy Date Normalization', () => {
    it('should normalize a standard year', () => {
        // Input: "1920" -> Sort Date: "1920-01-01"
        const result = parseFuzzyDate("1920");
        expect(result.sort_date).toBe("1920-01-01");
    });

    it('should calculate midpoint for "Between" ranges', () => {
        // Input: "Bet. 1900 and 1910" -> Midpoint 1905
        const result = parseFuzzyDate("Bet. 1900 and 1910");
        // Midpoint of 1900 and 1910 is roughly 1905-06-30
        expect(result.sort_date).toBe("1905-06-30");
    });
});
