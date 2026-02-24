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
