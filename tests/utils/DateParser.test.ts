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

    // Ancestry.com non-standard formats
    it('should handle MMM DD, YYYY (Ancestry format)', () => {
        expect(parseDate("Sep 28, 1873")).toBe("1873-09-28");
        expect(parseDate("Dec 26, 1939")).toBe("1939-12-26");
        expect(parseDate("Jun 7, 1877")).toBe("1877-06-07");
    });

    it('should handle full month name DD YYYY (Ancestry format)', () => {
        expect(parseDate("July 25 1889")).toBe("1889-07-25");
        expect(parseDate("December 28 1867")).toBe("1867-12-28");
        expect(parseDate("February 11 1959")).toBe("1959-02-11");
    });

    it('should handle BEFORE modifier (long form)', () => {
        expect(parseDate("Before 1951")).toBe("1950-12-31");
        expect(parseDate("BEFORE 1800")).toBe("1799-12-31");
    });

    it('should return null for empty or unparseable input', () => {
        expect(parseDate("")).toBeNull();
    });

    it('should extract year from MM/DD/YYYY format as fallback', () => {
        expect(parseDate("10/31/1931")).toBe("1931-01-01");
    });
});
