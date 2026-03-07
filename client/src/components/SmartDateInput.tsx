import { Input } from '@/components/ui/input';

const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
    sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a human-readable date string into ISO-8601 (YYYY-MM-DD).
 * Returns null if the input cannot be parsed.
 *
 * Handles:
 *   "1900"             → "1900-01-01"
 *   "1900-06"          → "1900-06-01"
 *   "1900-06-15"       → "1900-06-15"
 *   "15 Jun 1900"      → "1900-06-15"
 *   "Jun 15, 1900"     → "1900-06-15"
 *   "Jun 1900"         → "1900-06-01"
 *   "abt 1900"         → "1900-01-01"
 *   "circa 1900"       → "1900-01-01"
 *   "15 Jeune 1776"    → null  (unrecognized word — strict token matching)
 */
export function parseToISO(input: string): string | null {
    const s = input.trim();
    if (!s) return null;

    // Already full ISO YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // YYYY-MM
    if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;

    // "DD MonthName YYYY"  e.g. "15 Jun 1950"
    const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dmy) {
        const month = MONTHS[dmy[2].toLowerCase()];
        if (month) return `${dmy[3]}-${String(month).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }

    // "MonthName DD, YYYY" or "MonthName DD YYYY"  e.g. "Jun 15, 1950"
    const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (mdy) {
        const month = MONTHS[mdy[1].toLowerCase()];
        if (month) return `${mdy[3]}-${String(month).padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    }

    // "MonthName YYYY"  e.g. "Jun 1950"
    const my = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (my) {
        const month = MONTHS[my[1].toLowerCase()];
        if (month) return `${my[2]}-${String(month).padStart(2, '0')}-01`;
    }

    // Bare year "1900"
    if (/^\d{4}$/.test(s)) return `${s}-01-01`;

    // Year with recognized qualifiers only — explicit whitelist to prevent false positives.
    // Accepts: abt, about, circa, ca, c., ~, est, cal, bef, aft, bet, from + YYYY.
    // Rejects strings with unrecognized words like "15 Jeune 1776" or "Foo Bar 1900".
    const fuzzy = s.match(/^(?:abt\.?|about|circa|ca\.?|c\.|~|est\.?|cal\.?|bef\.?|aft\.?|bet\.?|from)\s*(\d{4})$/i);
    if (fuzzy) return `${fuzzy[1]}-01-01`;

    return null;
}

interface SmartDateInputProps {
    value: string;
    onChange: (displayDate: string, isoDate: string | null) => void;
    placeholder?: string;
    className?: string;
}

/**
 * A single date input that parses the value into ISO format on-the-fly.
 * Shows the derived ISO date as a dim overlay when it differs from the input.
 */
export function SmartDateInput({ value, onChange, placeholder, className }: SmartDateInputProps) {
    const iso = parseToISO(value);
    // Show ISO hint when we successfully parse something that isn't already ISO
    const showHint = !!value && !!iso && iso !== value.trim();
    // Warn (yellow border) only when the user has typed something we can't parse
    const unparseable = !!value && !iso;

    return (
        <div className="relative">
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value, parseToISO(e.target.value))}
                placeholder={placeholder ?? 'e.g. 15 Jun 1950'}
                className={`${className ?? 'h-8 text-sm'} ${showHint ? 'pr-24' : ''} ${unparseable ? 'border-yellow-500/70' : ''}`}
            />
            {showHint && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground pointer-events-none select-none">
                    {iso}
                </span>
            )}
        </div>
    );
}
