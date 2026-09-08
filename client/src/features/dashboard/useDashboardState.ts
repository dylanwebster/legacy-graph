import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/shared/store/uiStore';
import { migrateFocalFromDashboardState, useFocalStore } from '@/shared/store/focalStore';
import { loadDashboardState, saveDashboardState } from './dashboardState';
import type { DashboardState } from './dashboardState';

/**
 * Dashboard-level state shared across viz modes. Layout + vizMode are persisted
 * in dashboard-state-v1; the focal person is held in the shared focalStore so
 * other features (Map View) see the same value. rootPersonId on DashboardState
 * is a read-through view of the focalStore.
 */
export function useDashboardState(): [DashboardState, (updates: Partial<DashboardState>) => void] {
    const [dsState, setDsState] = useState<DashboardState>(() => {
        migrateFocalFromDashboardState();
        const loaded = loadDashboardState();
        return { ...loaded, rootPersonId: useFocalStore.getState().focalPersonId };
    });
    const focalPersonId = useFocalStore((s) => s.focalPersonId);
    const setFocal = useFocalStore((s) => s.setFocal);
    const setVizModeStore = useUIStore((s) => s.setDashboardVizMode);

    // Keep the local view in sync when the focal store changes from outside.
    useEffect(() => {
        setDsState((prev) => (prev.rootPersonId === focalPersonId ? prev : { ...prev, rootPersonId: focalPersonId }));
    }, [focalPersonId]);

    const updateDs = useCallback((updates: Partial<DashboardState>) => {
        if ('rootPersonId' in updates) setFocal(updates.rootPersonId ?? null);
        setDsState((prev) => {
            const next = { ...prev, ...updates };
            // Don't persist rootPersonId into dashboard-state-v1 — focalStore owns it.
            saveDashboardState({ ...next, rootPersonId: null });
            return next;
        });
    }, [setFocal]);

    useEffect(() => {
        setVizModeStore(dsState.vizMode);
    }, [dsState.vizMode, setVizModeStore]);

    return [dsState, updateDs];
}
