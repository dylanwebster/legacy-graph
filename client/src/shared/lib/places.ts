import type { Place } from '@/shared/api/people';

/** Build a human-readable display string from Place components.
 *  Skips admin/country parts that are already substrings of `name`. */
export function formatPlaceDisplay(place: Place | undefined | null): string {
    if (!place) return '';
    const parts: string[] = [place.name];
    const nameLower = place.name.toLowerCase();
    for (const val of [place.admin2Name, place.admin1Name, place.countryCode]) {
        if (val && !nameLower.includes(val.toLowerCase())) {
            parts.push(val);
        }
    }
    return parts.join(', ');
}

/** Format lat/lng as a compact coordinate string, e.g. "38.64°N, 120.53°W".
 *  Returns null if either coordinate is missing. */
export function formatCoordinates(place: Place | undefined | null): string | null {
    if (!place || place.lat == null || place.lng == null) return null;
    const lat = `${Math.abs(place.lat).toFixed(2)}°${place.lat >= 0 ? 'N' : 'S'}`;
    const lng = `${Math.abs(place.lng).toFixed(2)}°${place.lng >= 0 ? 'E' : 'W'}`;
    return `${lat}, ${lng}`;
}
