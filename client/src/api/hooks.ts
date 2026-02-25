import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleApi } from './people';
import type { CreatePersonInput } from './people';
import { apiFetch, deleteAsset } from './client';

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
            return apiFetch<any>(`/search?${searchParams.toString()}`);
        },
        enabled: !!q
    });
};

export const useSystemStatus = () => {
    return useQuery({
        queryKey: ['systemStatus'],
        queryFn: () => apiFetch<any>('/system/status'),
        refetchInterval: (query) => {
            const stateData = query.state.data as any;
            return stateData?.hydrationState === 'ready' ? false : 1000;
        }
    });
};

export const useStats = () => {
    return useQuery({
        queryKey: ['stats'],
        queryFn: () => apiFetch<any>('/stats')
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
                (old: any) => {
                    if (!old) return old;
                    return { ...old, assets: (old.assets as string[]).filter((a) => a !== filename) };
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

export const useUpdatePerson = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
            return apiFetch<any>(`/people/${id}`, {
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
