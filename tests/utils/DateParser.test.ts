// tests/utils/DateParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDate } from '../../src/utils/dateParser';

describe('Date Normalization', () => {
    it('should normalize a standard year', () => {
        // Input: "1920" -> Sort Date: "1920-01-01"
        const result = parseDate("1920");
        expect(result).toBe("1920-01-01");
    });

    it('should normalize Bet. ranges to start date', () => {
        // Input: "Bet. 1900 and 1910" -> 1900
        const result = parseDate("Bet 1900 and 1910");
        expect(result).toBe("1900-01-01");
    });

    it('should handle ABT modifier', () => {
        const result = parseDate("ABT 12 JAN 1990");
        expect(result).toBe("1990-01-12");
    });

    it('should handle MMM YYYY', () => {
        const result = parseDate("JAN 1980");
        expect(result).toBe("1980-01-01");
    });
});
