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

let activeEventSource: EventSource | null = null;

function connectToStream(set: (partial: Partial<GeocodeState> | ((state: GeocodeState) => Partial<GeocodeState>)) => void) {
    // Clean up any existing connection
    if (activeEventSource) {
        activeEventSource.close();
        activeEventSource = null;
    }

    const evtSource = new EventSource('/api/geocoding/batch/stream');
    activeEventSource = evtSource;

    evtSource.addEventListener('progress', (e) => {
        try {
            const data = JSON.parse(e.data);
            set({
                status: 'scanning',
                progress: { processed: data.processed, total: data.total, percent: data.percent },
            });
        } catch { /* ignore */ }
    });

    evtSource.addEventListener('complete', (e) => {
        try {
            const data = JSON.parse(e.data);
            const results: BatchGeocodeResult[] = data.results ?? [];
            const stats: BatchGeocodeStats = data.stats ?? null;

            // Auto-select high and medium confidence
            const checked = new Set<string>();
            for (const r of results) {
                if (r.match && (r.match.confidence === 'high' || r.match.confidence === 'medium')) {
                    checked.add(r.locationString);
                }
            }

            set({
                status: 'completed',
                progress: null,
                results,
                stats,
                checked,
                filter: 'all',
                searchQuery: '',
                error: null,
            });
        } catch { /* ignore */ }
        evtSource.close();
        activeEventSource = null;
    });

    evtSource.addEventListener('error', (e) => {
        const msgEvent = e as MessageEvent;
        try {
            if (msgEvent.data) {
                const data = JSON.parse(msgEvent.data);
                set({ status: 'error', error: data.message, progress: null });
                evtSource.close();
                activeEventSource = null;
            }
        } catch { /* ignore */ }
    });

    evtSource.onerror = () => {
        // Connection error — may auto-reconnect
    };
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
            // Connect to SSE stream for progress
            connectToStream(set);
        } catch (err) {
            set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to start scan', progress: null });
        }
    },

    loadPersistedResults: async () => {
        try {
            const response = await fetch('/api/geocoding/batch/results');
            if (response.status === 202) {
                // Job is currently running — reconnect to the stream
                set({ status: 'scanning', progress: { processed: 0, total: 0, percent: 0 } });
                connectToStream(set);
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
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
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
