// src/utils/dateParser.ts

export interface FuzzyDate {
    original: string;
    sort_date: string;
    quality: 'exact' | 'approximate';
}

export function parseFuzzyDate(input: string): FuzzyDate {
    // Regex for "Bet. YYYY and YYYY"
    const rangeMatch = input.match(/Bet\. (\d{4}) and (\d{4})/);

    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        const midYear = Math.floor((start + end) / 2);
        return {
            original: input,
            sort_date: `${midYear}-06-30`, // Midpoint logic
            quality: 'approximate'
        };
    }

    // Basic YYYY handling
    if (/^\d{4}$/.test(input)) {
        return {
            original: input,
            sort_date: `${input}-01-01`,
            quality: 'approximate'
        };
    }

    // Fallback (Tech Spec Requirement 3.1.2)
    return {
        original: input,
        sort_date: new Date().toISOString().split('T')[0],
        quality: 'approximate'
    };
}
