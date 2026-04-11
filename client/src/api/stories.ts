import { apiFetch } from './client';
import type { Place } from './people';

export interface StoryMetadata {
    title: string;
    date?: string;
    place?: Place;
    private: boolean;
    people: string[];
    tags: string[];
    assets: string[];
    created_at?: string;
    modified_at?: string;
}

export interface StoryFeedItem {
    id: string;
    title: string;
    date?: string;
    place?: Place;
    people: string[];
    excerpt: string;
    firstAsset?: string;
    private: boolean;
    created_at?: string;
    modified_at?: string;
}

export interface FullStory {
    id: string;
    metadata: StoryMetadata;
    content: string;
    mentions: string[];
}

export interface PaginatedStoriesResponse {
    stories: StoryFeedItem[];
    totalCount: number;
}

export interface CreateStoryInput {
    title: string;
    content?: string;
    date?: string;
    place?: Place;
    people?: string[];
    tags?: string[];
    private?: boolean;
}

export interface UpdateStoryInput {
    title?: string;
    content?: string;
    date?: string;
    place?: Place;
    people?: string[];
    tags?: string[];
    assets?: string[];
    private?: boolean;
}

export const storiesApi = {
    getStories: (params?: { limit?: number; offset?: number; sort?: string; personIds?: string[]; q?: string }) => {
        const searchParams = new URLSearchParams();
        if (params?.limit !== undefined) searchParams.append('limit', String(params.limit));
        if (params?.offset !== undefined) searchParams.append('offset', String(params.offset));
        if (params?.sort) searchParams.append('sort', params.sort);
        if (params?.personIds && params.personIds.length > 0)
            searchParams.append('personIds', params.personIds.join(','));
        if (params?.q) searchParams.append('q', params.q);
        const qs = searchParams.toString();
        return apiFetch<PaginatedStoriesResponse>(`/stories${qs ? `?${qs}` : ''}`);
    },

    getStory: (id: string) => apiFetch<FullStory>(`/stories/${id}`),

    createStory: (data: CreateStoryInput) =>
        apiFetch<FullStory>('/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),

    updateStory: (id: string, data: UpdateStoryInput) =>
        apiFetch<FullStory>(`/stories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }),

    deleteStory: (id: string) =>
        apiFetch<void>(`/stories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    deleteStoryMedia: async (id: string, filename: string): Promise<void> => {
        const response = await fetch(`/api/stories/${encodeURIComponent(id)}/media/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete story media: ${response.statusText}`);
        }
    },

    uploadMedia: async (id: string, file: File): Promise<FullStory> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`/api/stories/${id}/media`, {
            method: 'PUT',
            body: formData,
        });
        if (!response.ok) {
            throw new Error(`Failed to upload media: ${response.statusText}`);
        }
        return response.json();
    },
};
