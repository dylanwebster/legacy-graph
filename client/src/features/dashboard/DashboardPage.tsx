import { useState, useCallback, useEffect } from 'react';
import { useUIStore } from '@/shared/store/uiStore';
import { FamilyGraphPanel } from './FamilyGraphPanel';
import { loadDashboardState, saveDashboardState } from './dashboardState';
import type { DashboardState } from './dashboardState';

export function DashboardPage() {
    const [dsState, setDsState] = useState<DashboardState>(() => loadDashboardState());
    const setVizModeStore = useUIStore((s) => s.setDashboardVizMode);

    const updateDs = useCallback((updates: Partial<DashboardState>) => {
        setDsState((prev) => {
            const next = { ...prev, ...updates };
            saveDashboardState(next);
            return next;
        });
    }, []);

    // Keep Zustand store in sync so external components can read the current mode
    useEffect(() => {
        setVizModeStore(dsState.vizMode);
    }, [dsState.vizMode, setVizModeStore]);

    return (
        <div className="flex flex-col h-full">
            <FamilyGraphPanel dsState={dsState} updateDs={updateDs} />
        </div>
    );
}
