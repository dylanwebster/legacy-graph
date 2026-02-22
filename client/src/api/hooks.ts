import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleApi } from './people';
import { apiFetch } from './client';

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
        onMutate: async ({ id, updates }) => {
            await queryClient.cancelQueries({ queryKey: ['person', id] });
            const previousPerson = queryClient.getQueryData(['person', id]);
            queryClient.setQueryData(['person', id], (old: any) => ({
                ...old,
                ...updates
            }));
            return { previousPerson };
        },
        onError: (err, newPerson, context) => {
            queryClient.setQueryData(['person', newPerson.id], context?.previousPerson);
        },
        onSettled: (data, error, variables) => {
            queryClient.invalidateQueries({ queryKey: ['person', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['people'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        }
    });
};
