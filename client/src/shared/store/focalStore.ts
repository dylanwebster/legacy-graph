import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FOCAL_STORE_KEY = 'legacy-graph-focal-v1';

interface FocalState {
    focalPersonId: string | null;
    setFocal: (id: string | null) => void;
    clearFocal: () => void;
}

/** Shared focal person across the Dashboard (graph/fan/pedigree panels) and Map View.
 *  Persisted to localStorage so the focal survives reloads and is visible to any feature
 *  that wants to scope by "the currently focused person". */
export const useFocalStore = create<FocalState>()(
    persist(
        (set) => ({
            focalPersonId: null,
            setFocal: (id) => set({ focalPersonId: id }),
            clearFocal: () => set({ focalPersonId: null }),
        }),
        { name: FOCAL_STORE_KEY, version: 1 },
    ),
);

/** Legacy migration: first read of the store copies `rootPersonId` from the
 *  dashboard-state-v1 blob if the focal store itself is still empty. Idempotent.
 *  Exposed so useDashboardState can call it on mount. */
export function migrateFocalFromDashboardState(): void {
    if (typeof localStorage === 'undefined') return;
    if (useFocalStore.getState().focalPersonId !== null) return;
    try {
        const raw = localStorage.getItem('dashboard-state-v1');
        if (!raw) return;
        const parsed = JSON.parse(raw) as { rootPersonId?: string | null };
        if (parsed.rootPersonId) useFocalStore.getState().setFocal(parsed.rootPersonId);
    } catch { /* ignore */ }
}
