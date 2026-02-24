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

    // Handle BEF modifier: BEF 1850 -> 1849-12-31
    const befMatch = clean.match(/^BEF\s+(.+)$/i);
    if (befMatch) {
        const parsed = parseDate(befMatch[1]);
        if (parsed) {
            const year = parseInt(parsed.substring(0, 4), 10);
            return `${year - 1}-12-31`;
        }
        return null;
    }

    // Handle Modifiers: ABT, EST, CAL, AFT, FROM, TO -> Remove them (case-insensitive)
    // "ABT 12 JAN 1990" -> "12 JAN 1990"
    const datePart = clean.replace(/^(ABT|EST|CAL|AFT|FROM|TO)\s+/i, '').toUpperCase();

    const parts = datePart.split(' ');

    const monthMap: Record<string, string> = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
        'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    // Format: DD MMM YYYY (e.g., 10 JAN 1980)
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = monthMap[parts[1]] || '01';
        const year = parts[2];
        if (year.match(/^\d{4}$/)) {
            return `${year}-${month}-${day}`;
        }
    }

    // Format: MMM YYYY (e.g., JAN 1980)
    if (parts.length === 2) {
        const month = monthMap[parts[0]];
        const year = parts[1];
        if (month && year.match(/^\d{4}$/)) {
            return `${year}-${month}-01`;
        }
    }

    // Format: YYYY (e.g., 1980)
    const yearMatch = datePart.match(/\d{4}/);
    return yearMatch ? `${yearMatch[0]}-01-01` : null;
}
