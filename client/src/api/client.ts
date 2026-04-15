import type { Place } from './people';

// ── Asset types ────────────────────────────────────────────────────────────

export interface AssetMetadata {
    name?: string;
    description?: string;
    date?: string;        // when photo was taken
    location?: Place;
    created_at?: string;  // upload timestamp
    modified_at?: string; // last meta edit
}

export interface AssetStoryRef {
    id: string;
    title: string;
}

export interface AssetListItem {
    filename: string;
    size: number;
    mimeType: string;
    referencedBy: {
        people: string[];
        stories: AssetStoryRef[];
        events: Array<{ personId: string; eventId: string; eventType: string }>;
    };
    metadata: AssetMetadata;
    isOrphan: boolean;
}

export interface AssetListResponse {
    assets: AssetListItem[];
    totalCount: number;
}

// ── Generic fetch ──────────────────────────────────────────────────────────

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`/api${path}`, options);

    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch {
            // Ignore JSON parse errors for non-JSON error responses
        }
        throw new Error(errorMessage);
    }

    return response.json();
}

// Unlinks the asset from a person's profile (does NOT delete the file from disk).
export async function deleteAsset(personId: string, filename: string): Promise<void> {
    const response = await fetch(`/api/people/${personId}/media/${filename}`, { method: 'DELETE' });
    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
}

export async function deleteAssetPermanently(
    personId: string,
    filename: string,
): Promise<{ fileDeleted: boolean }> {
    const response = await fetch(
        `/api/people/${encodeURIComponent(personId)}/media/${encodeURIComponent(filename)}?permanent=true`,
        { method: 'DELETE' },
    );
    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
    return response.json();
}

export async function searchPlaces(q: string): Promise<Place[]> {
    if (q.trim().length < 2) return [];
    return apiFetch<Place[]>(`/places/search?q=${encodeURIComponent(q.trim())}`);
}

export async function resolvePlace(name: string): Promise<Place> {
    return apiFetch<Place>('/places/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
}

export interface AssetsQueryParams {
    q?: string;
    type?: 'all' | 'image' | 'document';
    sort?: 'name' | 'size' | 'date' | 'created' | 'modified';
    order?: 'asc' | 'desc';
    personIds?: string[];
}

export async function getAssets(params?: AssetsQueryParams): Promise<AssetListResponse> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.type && params.type !== 'all') qs.set('type', params.type);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
    if (params?.personIds && params.personIds.length > 0) qs.set('personIds', params.personIds.join(','));
    const queryString = qs.toString();
    return apiFetch<AssetListResponse>(`/assets${queryString ? `?${queryString}` : ''}`);
}

export async function updateAssetMeta(
    filename: string,
    meta: Partial<AssetMetadata>
): Promise<AssetMetadata> {
    return apiFetch<AssetMetadata>(`/assets/${encodeURIComponent(filename)}/meta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
    });
}

export async function unlinkAssetFromPerson(
    personId: string,
    filename: string
): Promise<void> {
    const response = await fetch(
        `/api/people/${personId}/assets/link/${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
    );
    if (!response.ok && response.status !== 204) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
}

export async function deleteGalleryAsset(filename: string, force = false): Promise<void> {
    const url = force
        ? `/api/assets/${encodeURIComponent(filename)}?force=true`
        : `/api/assets/${encodeURIComponent(filename)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
}

export async function uploadEventMedia(
    personId: string,
    eventId: string,
    file: File
): Promise<{ filename: string; events: unknown[] }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`/api/people/${personId}/events/${eventId}/media`, {
        method: 'PUT',
        body: formData,
    });
    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
    return response.json();
}

export interface UploadGalleryAssetsResult {
    uploaded: Array<{ filename: string; originalName: string }>;
    rejected: Array<{ originalName: string; reason: string }>;
}

export async function uploadGalleryAssets(files: File[]): Promise<UploadGalleryAssetsResult> {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file);
    }
    const response = await fetch('/api/assets/upload', { method: 'POST', body: formData });
    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch { /* ignore */ }
        throw new Error(errorMessage);
    }
    return response.json();
}

// ── Batch Geocoding ───────────────────────────────────────────────────────

export interface BatchGeocodeOccurrence {
    personId: string;
    personName: string;
    eventId: string;
    eventType: string;
}

export interface BatchGeocodeResult {
    locationString: string;
    occurrences: BatchGeocodeOccurrence[];
    match: {
        place: Place;
        confidence: 'high' | 'medium' | 'low';
        siteName: string | null;
    } | null;
}

export interface BatchGeocodeStats {
    total: number;
    high: number;
    medium: number;
    low: number;
    unmatched: number;
    alreadyResolved: number;
}

export interface BatchGeocodeUpdate {
    locationString: string;
    place: Place;
    siteName: string | null;
}

export interface BatchApplyResponse {
    updated: number;
    eventsUpdated: number;
}

export interface PersistedBatchGeocodeState {
    version: 1;
    completedAt: string;
    results: BatchGeocodeResult[];
    stats: BatchGeocodeStats;
    selections: {
        checked: string[];
        filter: string;
        searchQuery: string;
        sortBy?: string;
        sortOrder?: string;
        overrides?: Record<string, { place: Place; siteName: string | null }>;
    };
}

export async function startBatchGeocode(): Promise<{ jobId: string | null; status: string }> {
    return apiFetch<{ jobId: string | null; status: string }>('/geocoding/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
}

export async function getBatchGeocodeResults(): Promise<PersistedBatchGeocodeState | null> {
    const response = await fetch('/api/geocoding/batch/results');
    if (response.status === 404) return null;
    if (response.status === 202) return null; // Still running
    if (!response.ok) throw new Error('Failed to fetch batch geocoding results');
    return response.json();
}

export async function saveBatchGeocodeSelections(selections: {
    checked: string[];
    filter: string;
    searchQuery: string;
    sortBy?: string;
    sortOrder?: string;
    overrides?: Record<string, { place: Place; siteName: string | null }>;
}): Promise<void> {
    await apiFetch('/geocoding/batch/selections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selections),
    });
}

export async function clearBatchGeocodeResults(): Promise<void> {
    await apiFetch('/geocoding/batch/results', { method: 'DELETE' });
}

export async function applyBatchGeocode(updates: BatchGeocodeUpdate[]): Promise<BatchApplyResponse> {
    return apiFetch<BatchApplyResponse>('/geocoding/batch/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
    });
}

export async function linkAssetToPerson(
    personId: string,
    filename: string
): Promise<{ assets: string[] }> {
    return apiFetch<{ assets: string[] }>(`/people/${personId}/assets/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
    });
}
