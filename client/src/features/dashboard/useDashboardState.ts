import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/shared/store/uiStore';
import { loadDashboardState, saveDashboardState } from './dashboardState';
import type { DashboardState } from './dashboardState';

/**
 * Dashboard-level state shared across viz modes: the persisted DashboardState
 * (localStorage-backed) and the uiStore vizMode sync so external components
 * can react to the current mode. Returns the current state and an updater
 * that also persists.
 */
export function useDashboardState(): [DashboardState, (updates: Partial<DashboardState>) => void] {
    const [dsState, setDsState] = useState<DashboardState>(() => loadDashboardState());
    const setVizModeStore = useUIStore((s) => s.setDashboardVizMode);

    const updateDs = useCallback((updates: Partial<DashboardState>) => {
        setDsState((prev) => {
            const next = { ...prev, ...updates };
            saveDashboardState(next);
            return next;
        });
    }, []);

    useEffect(() => {
        setVizModeStore(dsState.vizMode);
    }, [dsState.vizMode, setVizModeStore]);

    return [dsState, updateDs];
}
