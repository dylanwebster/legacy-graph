import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/shared/api/client';
import type { MapEventsResponse, MapScope } from './types';

export interface UseMapEventsArgs {
    scope: MapScope;
    focalPersonId: string | null;
}

export function useMapEvents({ scope, focalPersonId }: UseMapEventsArgs) {
    const needsFocal = scope === 'focal' || scope === 'lineage';
    const enabled = !needsFocal || !!focalPersonId;
    return useQuery({
        queryKey: ['map/events', scope, focalPersonId],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (scope === 'focal' && focalPersonId) params.set('person', focalPersonId);
            if (scope === 'lineage' && focalPersonId) params.set('lineage', focalPersonId);
            const qs = params.toString();
            return apiFetch<MapEventsResponse>(`/map/events${qs ? `?${qs}` : ''}`);
        },
        enabled,
        staleTime: 30_000,
    });
}
