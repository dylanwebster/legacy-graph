import { apiFetch } from './client';

export interface Place {
    name: string;
    historicalName?: string;
    lat?: number;
    lng?: number;
    countryCode?: string;
    resolvedAt?: string;
}

export interface PersonName {
    primary?: boolean;
    first?: string;
    last?: string;
    given?: string;
    surname?: string;
}

export interface SlimPersonSummary {
    id: string;
    names: PersonName[];
    sex: string;
    birthDate?: string;
    deathDate?: string;
    tags: string[];
    assetCount: number;
    primaryAsset?: string;
    last_modified: string;
}

export interface PersonDetail {
    id: string;
    names: PersonName[];
    sex?: string;
    tags: string[];
    assets: string[];
    events: Array<Record<string, unknown>>;
    relationships: {
        parents: Array<{ id: string; type: string }>;
    };
    timeline: Array<Record<string, unknown>>;
    scrapbook_md?: string;
    _gedcom?: Record<string, unknown>;
    _computed: {
        currentSpouse: { id: string; status: string } | null;
        siblings: string[];
        children: string[];
        allSpouses: Array<{ id: string; status: string; sortDate: string }>;
    };
    last_modified: string;
}

export interface PaginatedPeopleResponse {
    people: SlimPersonSummary[];
    totalCount: number;
}

export interface CreatePersonInput {
    names: Array<{ first?: string; last?: string; primary?: boolean }>;
    sex: string;
}

export const peopleApi = {
    createPerson: async (data: CreatePersonInput) => {
        return apiFetch<PersonDetail>('/people', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },

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
        return apiFetch<PersonDetail>(`/people/${id}${query ? `?${query}` : ''}`);
    }
};
