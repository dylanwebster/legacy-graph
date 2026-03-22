import type { Place } from './people';

// ── Asset types ────────────────────────────────────────────────────────────

export interface AssetMetadata {
    name?: string;
    description?: string;
    date?: string;
    location?: string;
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
    sort?: 'name' | 'size' | 'date';
    order?: 'asc' | 'desc';
}

export async function getAssets(params?: AssetsQueryParams): Promise<AssetListResponse> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.type && params.type !== 'all') qs.set('type', params.type);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
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

export async function deleteGalleryAsset(filename: string): Promise<void> {
    const response = await fetch(`/api/assets/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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
