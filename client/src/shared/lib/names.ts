/**
 * Abbreviate a full name for compact display (e.g. on pedigree cards).
 *
 * Rules applied in order:
 *  1. Strip quoted nicknames — `"Sally"`, `'Sadie'`
 *  2. Strip parenthetical metadata — `(Twin)`, `(Jr.)`
 *  3. Abbreviate every middle name (words between first and last) to a single
 *     initial. Multiple middles are concatenated without spaces: `J.J.`
 *
 * Examples:
 *   "Dylan Patrick Webster"        → "Dylan P. Webster"
 *   "Gene E Webster"               → "Gene E. Webster"
 *   "Sarah \"Sally\" Webster"      → "Sarah Webster"
 *   "Lasa (Twin) Webster"          → "Lasa Webster"
 *   "Sarah Anna \"Sadie\" Webster" → "Sarah A. Webster"
 *   "John Jacob Jingleheimer Schmidt" → "John J.J. Schmidt"
 */
export function abbreviateName(label: string): string {
    // Strip quoted nicknames (double or single quotes)
    let cleaned = label.replace(/\s*["'][^"']*["']\s*/g, ' ');
    // Strip parenthetical metadata
    cleaned = cleaned.replace(/\s*\([^)]*\)\s*/g, ' ');
    // Normalize whitespace
    cleaned = cleaned.trim().replace(/\s+/g, ' ');

    const parts = cleaned.split(' ');
    if (parts.length <= 2) return cleaned;

    const first = parts[0];
    const last = parts[parts.length - 1];
    const middles = parts.slice(1, -1);

    // Abbreviate each middle to its first letter + period, then concatenate
    const abbreviated = middles
        .map(m => {
            if (!m) return '';
            // Strip any existing trailing period so we normalise "E." → "E."
            const initial = m.replace(/\.$/, '')[0]?.toUpperCase() ?? '';
            return initial ? `${initial}.` : '';
        })
        .filter(Boolean)
        .join('');

    return abbreviated ? `${first} ${abbreviated} ${last}` : `${first} ${last}`;
}
