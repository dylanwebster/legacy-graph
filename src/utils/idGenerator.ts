import { customAlphabet } from 'nanoid';

const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/**
 * Converts a string to a URL-safe slug segment.
 * Normalizes NFD, strips diacritics, lowercases, replaces non-alphanum with '-',
 * collapses multiple dashes, trims leading/trailing dashes.
 */
function slugify(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-');
}

/**
 * Generates a human-readable person ID in the format:
 *   N_[first]-[last]-[birthyear]-[nanoid8]
 *
 * Each segment is slugified. The prefix (everything before the trailing nanoid)
 * is truncated to 24 characters. The nanoid guarantees uniqueness.
 */
export function generatePersonId(person: {
    names?: Array<{ first?: string; last?: string; primary?: boolean }>;
    events?: Array<{ type: string; date?: string | null; sort_date?: string | null }>;
}): string {
    const primaryName = person.names?.find(n => n.primary) ?? person.names?.[0];
    const first = slugify(primaryName?.first || 'unknown');
    const last = slugify(primaryName?.last || 'unknown');

    const birthEvent = person.events?.find(e => e.type === 'birth');
    const rawDate = birthEvent?.sort_date || birthEvent?.date;
    const birthYearMatch = rawDate?.match(/(\d{4})/);
    const birthYear = birthYearMatch ? birthYearMatch[1] : '';

    const parts = [first, last, birthYear].filter(Boolean);
    const prefix = parts.join('-').slice(0, 24).replace(/-+$/g, '');

    return `N_${prefix}-${nanoid8()}`;
}
