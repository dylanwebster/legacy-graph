export interface DateRange {
    sort_date: string | null;
    sort_end_date: string | undefined;
}

/** Parse a GEDCOM-ish date into explicit [start, end]. End is undefined for single-point dates
 *  (matches the schema shape, where sort_end_date is an optional field rather than nullable).
 *  Unlike parseDate (which collapses BET/FROM-TO to a midpoint for legacy callers),
 *  this preserves the full range — required for map playback and timeline spans. */
export function parseDateRange(d: string): DateRange {
    if (!d) return { sort_date: null, sort_end_date: undefined };
    const clean = d.trim();

    const bet = clean.match(/^BET\s+(.+?)\s+AND\s+(.+)$/i);
    if (bet) {
        return { sort_date: parseDate(bet[1]), sort_end_date: parseDate(bet[2]) ?? undefined };
    }
    const fromTo = clean.match(/^FROM\s+(.+?)\s+TO\s+(.+)$/i);
    if (fromTo) {
        return { sort_date: parseDate(fromTo[1]), sort_end_date: parseDate(fromTo[2]) ?? undefined };
    }
    return { sort_date: parseDate(clean), sort_end_date: undefined };
}

export function parseDate(d: string): string | null {
    if (!d) return null;

    const clean = d.trim();

    // Handle Range: BET 1900 AND 1910 -> midpoint 1905-06-01
    const rangeMatch = clean.match(/^BET\s+(.+?)\s+AND\s+(.+)$/i);
    if (rangeMatch) {
        const startParsed = parseDate(rangeMatch[1]);
        const endParsed = parseDate(rangeMatch[2]);
        if (startParsed && endParsed) {
            const startYear = parseInt(startParsed.substring(0, 4), 10);
            const endYear = parseInt(endParsed.substring(0, 4), 10);
            const midYear = Math.floor((startYear + endYear) / 2);
            return `${midYear}-06-01`;
        }
        return startParsed;
    }

    // Handle BEF/BEFORE modifier: BEF 1850 -> 1849-12-31
    const befMatch = clean.match(/^(BEF|BEFORE)\s+(.+)$/i);
    if (befMatch) {
        const parsed = parseDate(befMatch[2]);
        if (parsed) {
            const year = parseInt(parsed.substring(0, 4), 10);
            return `${year - 1}-12-31`;
        }
        return null;
    }

    // Handle Modifiers: ABT, EST, CAL, AFT, FROM, TO, ABOUT, CIRCA -> Remove them (case-insensitive)
    const datePart = clean.replace(/^(ABT|EST|CAL|AFT|FROM|TO|ABOUT|CIRCA)\s+/i, '').toUpperCase();

    const parts = datePart.split(/\s+/).filter(Boolean);

    const monthMap: Record<string, string> = {
        // Standard GEDCOM 3-letter abbreviations
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
        'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12',
        // Full month names (Ancestry.com and other sources export these)
        'JANUARY': '01', 'FEBRUARY': '02', 'MARCH': '03', 'APRIL': '04',
        'JUNE': '06', 'JULY': '07', 'AUGUST': '08', 'SEPTEMBER': '09',
        'OCTOBER': '10', 'NOVEMBER': '11', 'DECEMBER': '12'
    };

    if (parts.length === 3) {
        // Standard GEDCOM: DD MMM YYYY (e.g., "10 JAN 1980", "28 SEP 1873")
        const stdMonth = monthMap[parts[1]];
        if (stdMonth && parts[0].match(/^\d{1,2}$/) && parts[2].match(/^\d{4}$/)) {
            const day = parts[0].padStart(2, '0');
            return `${parts[2]}-${stdMonth}-${day}`;
        }

        // Non-standard (Ancestry.com): MMM DD, YYYY or Month DD YYYY
        // e.g., "Sep 28, 1873" or "July 25 1889"
        const altMonth = monthMap[parts[0]];
        const altDay = parts[1].replace(',', '');
        if (altMonth && altDay.match(/^\d{1,2}$/) && parts[2].match(/^\d{4}$/)) {
            return `${parts[2]}-${altMonth}-${altDay.padStart(2, '0')}`;
        }
    }

    // Format: MMM YYYY (e.g., "JAN 1980", "Nov 1860")
    if (parts.length === 2) {
        const month = monthMap[parts[0]];
        const year = parts[1];
        if (month && year.match(/^\d{4}$/)) {
            return `${year}-${month}-01`;
        }
    }

    // Fallback: extract any 4-digit year (handles YYYY, MM/DD/YYYY, year ranges, etc.)
    const yearMatch = datePart.match(/\d{4}/);
    return yearMatch ? `${yearMatch[0]}-01-01` : null;
}
