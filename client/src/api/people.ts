import { apiFetch } from './client';

export interface SlimPersonSummary {
    id: string;
    names: any[];
    sex: string;
    birthDate?: string;
    deathDate?: string;
    tags: string[];
    assetCount: number;
    last_modified: string;
}

export interface PaginatedPeopleResponse {
    people: SlimPersonSummary[];
    totalCount: number;
}

export const peopleApi = {
    getPeople: async (params?: { limit?: number; offset?: number; sort?: string; order?: string }) => {
        const searchParams = new URLSearchParams();
        if (params?.limit !== undefined) searchParams.append('limit', String(params.limit));
        if (params?.offset !== undefined) searchParams.append('offset', String(params.offset));
        if (params?.sort) searchParams.append('sort', params.sort);
        if (params?.order) searchParams.append('order', params.order);

        const query = searchParams.toString();
        return apiFetch<PaginatedPeopleResponse>(`/people${query ? `?${query}` : ''}`);
    },

    getPerson: async (id: string, timelineParams?: { limit?: number; offset?: number }) => {
        const searchParams = new URLSearchParams();
        if (timelineParams?.limit !== undefined) searchParams.append('timeline_limit', String(timelineParams.limit));
        if (timelineParams?.offset !== undefined) searchParams.append('timeline_offset', String(timelineParams.offset));

        const query = searchParams.toString();
        return apiFetch<any>(`/people/${id}${query ? `?${query}` : ''}`);
    }
};
