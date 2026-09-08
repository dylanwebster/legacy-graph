// tests/utils/DateParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDate, parseDateRange } from '../../src/utils/dateParser';

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

describe('Date Range Parsing', () => {
    it('parses BET … AND … as an explicit range', () => {
        expect(parseDateRange('BET 1900 AND 1910')).toEqual({
            sort_date: '1900-01-01',
            sort_end_date: '1910-01-01',
        });
    });

    it('parses FROM … TO … as an explicit range', () => {
        expect(parseDateRange('FROM 1910 TO 1920')).toEqual({
            sort_date: '1910-01-01',
            sort_end_date: '1920-01-01',
        });
    });

    it('parses FROM … TO … with full dates', () => {
        expect(parseDateRange('FROM 10 JAN 1942 TO 2 SEP 1945')).toEqual({
            sort_date: '1942-01-10',
            sort_end_date: '1945-09-02',
        });
    });

    it('returns null sort_end_date for a single point', () => {
        expect(parseDateRange('1920')).toEqual({
            sort_date: '1920-01-01',
            sort_end_date: undefined,
        });
    });

    it('returns null sort_end_date for BEF/AFT modifiers (single points)', () => {
        expect(parseDateRange('BEF 1850')).toEqual({
            sort_date: '1849-12-31',
            sort_end_date: undefined,
        });
        expect(parseDateRange('AFT 1900')).toEqual({
            sort_date: '1900-01-01',
            sort_end_date: undefined,
        });
    });

    it('returns nullish fields for empty input', () => {
        expect(parseDateRange('')).toEqual({ sort_date: null, sort_end_date: undefined });
    });

    it('is case-insensitive on range keywords', () => {
        expect(parseDateRange('from 1910 to 1920')).toEqual({
            sort_date: '1910-01-01',
            sort_end_date: '1920-01-01',
        });
        expect(parseDateRange('bet 1900 and 1910')).toEqual({
            sort_date: '1900-01-01',
            sort_end_date: '1910-01-01',
        });
    });

    it('leaves parseDate midpoint behavior intact for BET (backward-compat)', () => {
        // parseDate still returns midpoint for existing callers that expect a single sort_date
        expect(parseDate('BET 1900 AND 1910')).toBe('1905-06-01');
    });
});
