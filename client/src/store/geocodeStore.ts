import { create } from 'zustand';
import type { BatchGeocodeResult, BatchGeocodeStats, BatchGeocodeUpdate } from '@/api/client';
import {
    startBatchGeocode,
    saveBatchGeocodeSelections,
    clearBatchGeocodeResults,
    applyBatchGeocode,
} from '@/api/client';

export type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low' | 'unmatched';

interface GeocodeState {
    status: 'idle' | 'scanning' | 'completed' | 'error';
    progress: { processed: number; total: number; percent: number } | null;
    results: BatchGeocodeResult[];
    stats: BatchGeocodeStats | null;
    checked: Set<string>;
    filter: ConfidenceFilter;
    searchQuery: string;
    dialogOpen: boolean;
    error: string | null;

    startScan: () => Promise<void>;
    loadPersistedResults: () => Promise<void>;
    toggleSelection: (locationString: string) => void;
    setFilter: (filter: ConfidenceFilter) => void;
    setSearchQuery: (q: string) => void;
    setDialogOpen: (open: boolean) => void;
    applySelected: () => Promise<{ updated: number; eventsUpdated: number }>;
    clearResults: () => Promise<void>;
    reset: () => void;
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debounceSaveSelections(state: GeocodeState) {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        saveBatchGeocodeSelections({
            checked: Array.from(state.checked),
            filter: state.filter,
            searchQuery: state.searchQuery,
        }).catch(() => { /* best-effort */ });
    }, 500);
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function pollForResults(set: (partial: Partial<GeocodeState> | ((state: GeocodeState) => Partial<GeocodeState>)) => void) {
    stopPolling();

    const poll = async () => {
        try {
            const response = await fetch('/api/geocoding/batch/results');
            if (response.status === 202) {
                // Job still running — update progress
                const data = await response.json();
                if (data.progress) {
                    set({
                        status: 'scanning',
                        progress: {
                            processed: data.progress.processed,
                            total: data.progress.total,
                            percent: data.progress.percent,
                        },
                    });
                }
                // Continue polling
                pollTimer = setTimeout(poll, 500);
            } else if (response.ok) {
                // Job completed — load results
                const persisted = await response.json();
                const results: BatchGeocodeResult[] = persisted.results ?? [];
                const stats: BatchGeocodeStats = persisted.stats ?? null;

                // Use persisted selections if available, otherwise auto-select high/medium
                let checked: Set<string>;
                if (persisted.selections?.checked) {
                    checked = new Set(persisted.selections.checked);
                } else {
                    checked = new Set<string>();
                    for (const r of results) {
                        if (r.match && (r.match.confidence === 'high' || r.match.confidence === 'medium')) {
                            checked.add(r.locationString);
                        }
                    }
                }

                set({
                    status: 'completed',
                    progress: null,
                    results,
                    stats,
                    checked,
                    filter: (persisted.selections?.filter as ConfidenceFilter) || 'all',
                    searchQuery: persisted.selections?.searchQuery || '',
                    error: null,
                });
                pollTimer = null;
            } else {
                // 404 or other error — job disappeared
                set({ status: 'error', error: 'Scan failed unexpectedly', progress: null });
                pollTimer = null;
            }
        } catch {
            // Network error — retry
            pollTimer = setTimeout(poll, 2000);
        }
    };

    // Start first poll after a short delay to let the job begin
    pollTimer = setTimeout(poll, 500);
}

export const useGeocodeStore = create<GeocodeState>((set, get) => ({
    status: 'idle',
    progress: null,
    results: [],
    stats: null,
    checked: new Set<string>(),
    filter: 'all',
    searchQuery: '',
    dialogOpen: false,
    error: null,

    startScan: async () => {
        set({ status: 'scanning', progress: { processed: 0, total: 0, percent: 0 }, error: null });
        try {
            const res = await startBatchGeocode();
            if (res.status === 'completed') {
                // Results already exist — load them
                await get().loadPersistedResults();
                return;
            }
            // Poll for progress
            pollForResults(set);
        } catch (err) {
            set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to start scan', progress: null });
        }
    },

    loadPersistedResults: async () => {
        try {
            const response = await fetch('/api/geocoding/batch/results');
            if (response.status === 202) {
                // Job is currently running — start polling
                const data = await response.json();
                set({
                    status: 'scanning',
                    progress: data.progress ?? { processed: 0, total: 0, percent: 0 },
                });
                pollForResults(set);
            } else if (response.ok) {
                const persisted = await response.json();
                set({
                    status: 'completed',
                    results: persisted.results,
                    stats: persisted.stats,
                    checked: new Set(persisted.selections.checked),
                    filter: (persisted.selections.filter as ConfidenceFilter) || 'all',
                    searchQuery: persisted.selections.searchQuery || '',
                    progress: null,
                    error: null,
                });
            } else {
                // 404 or other — no results on server, reset to idle
                set({ status: 'idle', results: [], stats: null, checked: new Set(), progress: null, error: null });
            }
        } catch {
            // No results, stay idle
        }
    },

    toggleSelection: (locationString: string) => {
        set((state) => {
            const next = new Set(state.checked);
            if (next.has(locationString)) next.delete(locationString);
            else next.add(locationString);
            return { checked: next };
        });
        debounceSaveSelections(get());
    },

    setFilter: (filter: ConfidenceFilter) => {
        set({ filter });
        debounceSaveSelections(get());
    },

    setSearchQuery: (q: string) => {
        set({ searchQuery: q });
        debounceSaveSelections(get());
    },

    setDialogOpen: (open: boolean) => {
        set({ dialogOpen: open });
    },

    applySelected: async () => {
        const { results, checked } = get();
        const updates: BatchGeocodeUpdate[] = [];
        for (const r of results) {
            if (checked.has(r.locationString) && r.match) {
                updates.push({
                    locationString: r.locationString,
                    place: r.match.place,
                    siteName: r.match.siteName,
                });
            }
        }
        if (updates.length === 0) throw new Error('No selections to apply');

        const result = await applyBatchGeocode(updates);
        // Apply clears server results; reset local state
        set({
            status: 'idle',
            results: [],
            stats: null,
            checked: new Set(),
            filter: 'all',
            searchQuery: '',
            dialogOpen: false,
            progress: null,
        });
        return result;
    },

    clearResults: async () => {
        await clearBatchGeocodeResults();
        set({
            status: 'idle',
            results: [],
            stats: null,
            checked: new Set(),
            filter: 'all',
            searchQuery: '',
            progress: null,
            error: null,
        });
    },

    reset: () => {
        stopPolling();
        set({
            status: 'idle',
            progress: null,
            results: [],
            stats: null,
            checked: new Set(),
            filter: 'all',
            searchQuery: '',
            dialogOpen: false,
            error: null,
        });
    },
}));
