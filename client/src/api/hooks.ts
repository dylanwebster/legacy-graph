import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleApi } from './people';
import type { CreatePersonInput, PersonDetail, SlimPersonSummary } from './people';
import {
    apiFetch, deleteAsset, deleteAssetPermanently, searchPlaces, resolvePlace,
    getAssets, updateAssetMeta, deleteGalleryAsset, uploadEventMedia, linkAssetToPerson,
    unlinkAssetFromPerson,
} from './client';
import type { AssetListResponse, AssetListItem, AssetsQueryParams } from './client';
import type { Place } from './people';
import { storiesApi } from './stories';
import type { CreateStoryInput, UpdateStoryInput, StoryFeedItem } from './stories';

export interface PlaceResult {
    location: string;
    count: number;
}

export interface SearchResponse {
    people: SlimPersonSummary[];
    stories: StoryFeedItem[];
    places: PlaceResult[];
    totalCounts: {
        people: number;
        stories: number;
        places: number;
    };
}

export interface SystemStatus {
    nodeCount: number;
    edgeCount: number;
    hydrationState: string;
    cacheAge: number | null;
}

export interface StatsResponse {
    totalPeople: number;
    totalFamilies: number;
    lastModified: string | null;
}

export interface GraphNodeData {
    id: string;
    label: string;
    sex: string;
    birthYear: number | null;
    primaryAsset: string | null;
}

export interface GraphLinkData {
    source: string;
    target: string;
    type: 'parent_child' | 'spouse';
    status?: string;
}

export const usePeople = (params?: { limit?: number; offset?: number; sort?: string; order?: string }) => {
    return useQuery({
        queryKey: ['people', params],
        queryFn: () => peopleApi.getPeople(params)
    });
};

export const usePerson = (id: string, timelineParams?: { limit?: number; offset?: number }) => {
    return useQuery({
        queryKey: ['person', id, timelineParams],
        queryFn: () => peopleApi.getPerson(id, timelineParams),
        enabled: !!id
    });
};

export const useSearch = (q: string, params?: { limit?: number; offset?: number }) => {
    return useQuery({
        queryKey: ['search', q, params],
        queryFn: async () => {
            const searchParams = new URLSearchParams();
            if (q) searchParams.append('q', q);
            if (params?.limit !== undefined) searchParams.append('limit', String(params.limit));
            if (params?.offset !== undefined) searchParams.append('offset', String(params.offset));
            return apiFetch<SearchResponse>(`/search?${searchParams.toString()}`);
        },
        enabled: !!q
    });
};

export const useSystemStatus = () => {
    return useQuery({
        queryKey: ['systemStatus'],
        queryFn: () => apiFetch<SystemStatus>('/system/status'),
        refetchInterval: (query) => {
            const stateData = query.state.data as SystemStatus | undefined;
            return stateData?.hydrationState === 'ready' ? false : 1000;
        }
    });
};

export const useStats = () => {
    return useQuery({
        queryKey: ['stats'],
        queryFn: () => apiFetch<StatsResponse>('/stats')
    });
};

export const useGraphData = () => {
    return useQuery({
        queryKey: ['graphData'],
        queryFn: async () => {
            const raw = await apiFetch<{ nodes: GraphNodeData[]; edges: GraphLinkData[] }>('/graph');
            return { nodes: raw.nodes, links: raw.edges };
        },
        staleTime: 30_000
    });
};

export const useCreatePerson = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: CreatePersonInput) => peopleApi.createPerson(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['people'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        },
    });
};

export const useDeleteAsset = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ personId, filename }: { personId: string; filename: string }) =>
            deleteAsset(personId, filename),
        onMutate: async ({ personId, filename }) => {
            await queryClient.cancelQueries({ queryKey: ['person', personId] });
            const previousData = queryClient.getQueriesData({ queryKey: ['person', personId] });
            queryClient.setQueriesData(
                { queryKey: ['person', personId] },
                (old: PersonDetail | undefined) => {
                    if (!old) return old;
                    return { ...old, assets: old.assets.filter((a) => a !== filename) };
                }
            );
            return { previousData };
        },
        onError: (_err, { personId }, context) => {
            if (context?.previousData) {
                for (const [queryKey, data] of context.previousData) {
                    queryClient.setQueryData(queryKey, data);
                }
            }
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
        },
        onSuccess: (_data, { personId }) => {
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
            queryClient.invalidateQueries({ queryKey: ['people'] });
        },
    });
};

export const useDeleteAssetPermanently = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ personId, filename }: { personId: string; filename: string }) =>
            deleteAssetPermanently(personId, filename),
        onMutate: async ({ personId, filename }) => {
            await queryClient.cancelQueries({ queryKey: ['person', personId] });
            const previousData = queryClient.getQueriesData({ queryKey: ['person', personId] });
            queryClient.setQueriesData(
                { queryKey: ['person', personId] },
                (old: PersonDetail | undefined) => {
                    if (!old) return old;
                    return { ...old, assets: old.assets.filter((a) => a !== filename) };
                }
            );
            return { previousData };
        },
        onError: (_err, { personId }, context) => {
            if (context?.previousData) {
                for (const [queryKey, data] of context.previousData) {
                    queryClient.setQueryData(queryKey, data);
                }
            }
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
        },
        onSuccess: (_data, { personId }) => {
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
            queryClient.invalidateQueries({ queryKey: ['people'] });
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};

export const usePlacesSearch = (q: string) => {
    return useQuery({
        queryKey: ['placesSearch', q],
        queryFn: () => searchPlaces(q),
        enabled: q.trim().length >= 2,
        staleTime: 60_000,
    });
};

export const useResolvePlace = () => {
    return useMutation({
        mutationFn: (name: string) => resolvePlace(name),
    });
};

// ── Stories ────────────────────────────────────────────────────────────────

export const useStories = (params?: { limit?: number; offset?: number; sort?: string; personIds?: string[]; q?: string }) => {
    return useQuery({
        queryKey: ['stories', params],
        queryFn: () => storiesApi.getStories(params),
    });
};

export const useStory = (id: string) => {
    return useQuery({
        queryKey: ['story', id],
        queryFn: () => storiesApi.getStory(id),
        enabled: !!id && id !== 'new',
    });
};

export const useCreateStory = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateStoryInput) => storiesApi.createStory(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stories'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        },
    });
};

export const useUpdateStory = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: UpdateStoryInput }) =>
            storiesApi.updateStory(id, data),
        onSuccess: (result, variables) => {
            // Use setQueryData instead of invalidate so the story effect in StoryPage
            // doesn't fire and overwrite the editor's in-progress content.
            queryClient.setQueryData(['story', variables.id], result);
            queryClient.invalidateQueries({ queryKey: ['stories'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        },
    });
};

export const useDeleteStory = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => storiesApi.deleteStory(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['stories'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        },
    });
};

export const useDeleteStoryMedia = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, filename }: { id: string; filename: string }) =>
            storiesApi.deleteStoryMedia(id, filename),
        onSuccess: (_result, variables) => {
            queryClient.invalidateQueries({ queryKey: ['story', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['stories'] });
        },
    });
};

export const useUploadStoryMedia = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, file }: { id: string; file: File }) =>
            storiesApi.uploadMedia(id, file),
        onSuccess: (_result, variables) => {
            queryClient.invalidateQueries({ queryKey: ['story', variables.id] });
        },
    });
};

// ── People mutations ───────────────────────────────────────────────────────

export const useUpdatePerson = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
            return apiFetch<PersonDetail>(`/people/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
        },
        onSettled: (_data, _error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['person', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['people'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        }
    });
};

// ── Asset Gallery ──────────────────────────────────────────────────────────

export const useAssets = (params?: AssetsQueryParams) => {
    return useQuery({
        queryKey: ['assets', params],
        queryFn: () => getAssets(params),
        staleTime: 30_000,
    });
};

export const useUpdateAssetMeta = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ filename, meta }: { filename: string; meta: { name?: string; description?: string; date?: string; location?: Place } }) =>
            updateAssetMeta(filename, meta),
        onMutate: async ({ filename, meta }) => {
            await queryClient.cancelQueries({ queryKey: ['assets'] });
            const previousData = queryClient.getQueriesData<AssetListResponse>({ queryKey: ['assets'] });
            queryClient.setQueriesData<AssetListResponse>({ queryKey: ['assets'] }, (old) => {
                if (!old) return old;
                return {
                    ...old,
                    assets: old.assets.map((a: AssetListItem) =>
                        a.filename === filename
                            ? { ...a, metadata: { ...a.metadata, ...meta } }
                            : a
                    ),
                };
            });
            return { previousData };
        },
        onError: (_err, _vars, context) => {
            if (context?.previousData) {
                for (const [queryKey, data] of context.previousData) {
                    queryClient.setQueryData(queryKey, data);
                }
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};

export const useDeleteGalleryAsset = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ filename, force }: { filename: string; force?: boolean }) =>
            deleteGalleryAsset(filename, force),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};

export const useUploadEventMedia = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ personId, eventId, file }: { personId: string; eventId: string; file: File }) =>
            uploadEventMedia(personId, eventId, file),
        onSettled: (_data, _error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['person', variables.personId] });
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};

export const useLinkAsset = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ personId, filename }: { personId: string; filename: string }) =>
            linkAssetToPerson(personId, filename),
        onSettled: (_data, _error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['person', variables.personId] });
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};

export const useUnlinkAsset = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ personId, filename }: { personId: string; filename: string }) =>
            unlinkAssetFromPerson(personId, filename),
        onSettled: (_data, _error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['person', variables.personId] });
            queryClient.invalidateQueries({ queryKey: ['assets'] });
        },
    });
};
