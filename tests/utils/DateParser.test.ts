// tests/utils/DateParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDate } from '../../src/utils/dateParser';

describe('Date Normalization', () => {
    it('should normalize a standard year', () => {
        // Input: "1920" -> Sort Date: "1920-01-01"
        const result = parseDate("1920");
        expect(result).toBe("1920-01-01");
    });

    it('should normalize BET ranges to midpoint date', () => {
        // BET 1900 AND 1910 -> midpoint 1905-06-01
        const result = parseDate("Bet 1900 and 1910");
        expect(result).toBe("1905-06-01");
    });

    it('should normalize BEF to year before', () => {
        // BEF 1850 -> 1849-12-31
        const result = parseDate("Bef 1850");
        expect(result).toBe("1849-12-31");
    });

    it('should handle ABT modifier', () => {
        const result = parseDate("ABT 12 JAN 1990");
        expect(result).toBe("1990-01-12");
    });

    it('should handle MMM YYYY', () => {
        const result = parseDate("JAN 1980");
        expect(result).toBe("1980-01-01");
    });

    it('should handle AFT modifier', () => {
        const result = parseDate("AFT 1900");
        expect(result).toBe("1900-01-01");
    });
});
