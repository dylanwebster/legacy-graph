export function parseDate(d: string): string {
    if (!d) return "0000-01-01";
    
    const clean = d.toUpperCase().trim();
    
    // Handle Range: BET 1900 AND 1910 -> 1900
    const rangeMatch = clean.match(/BET\s+(.+)\s+AND/);
    if (rangeMatch) {
            return parseDate(rangeMatch[1]);
    }
    
    // Handle Modifiers: ABT, EST, CAL, BEF, AFT -> Remove them
    // "ABT 12 JAN 1990" -> "12 JAN 1990"
    const datePart = clean.replace(/^(ABT|EST|CAL|BEF|AFT|FROM|TO)\s+/, '');
    
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
    return yearMatch ? `${yearMatch[0]}-01-01` : "0000-01-01";
}
