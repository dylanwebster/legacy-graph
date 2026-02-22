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
