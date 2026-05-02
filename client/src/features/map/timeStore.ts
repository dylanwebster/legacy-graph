import { create } from 'zustand';
import { useMapPrefsStore } from './prefsStore';
import type { Granularity } from './types';

export const GRANULARITY_WIDTH: Record<Granularity, number> = {
    year: 5,
    decade: 20,
    century: 100,
};

interface TimeState {
    /** Epoch-year start of the visible window (e.g. 1900). */
    windowStart: number;
    /** Epoch-year end of the visible window. */
    windowEnd: number;
    /** When true, undated events are visible and the window is ignored. */
    showUndated: boolean;
    /** Extent of all loaded events, used as slider bounds. */
    extentStart: number;
    extentEnd: number;
    isPlaying: boolean;
    /** True once initWindowForExtent has seeded a window. Prevents reseeding on refetch. */
    extentSeeded: boolean;

    setWindow: (start: number, end: number) => void;
    setShowUndated: (v: boolean) => void;
    setPlaying: (v: boolean) => void;
    setExtent: (min: number, max: number) => void;
}

export const useTimeStore = create<TimeState>((set) => ({
    windowStart: 1900,
    windowEnd: 2000,
    showUndated: false,
    extentStart: 1800,
    extentEnd: new Date().getFullYear(),
    isPlaying: false,
    extentSeeded: false,
    setWindow: (windowStart, windowEnd) => set({ windowStart, windowEnd }),
    setShowUndated: (showUndated) => set({ showUndated }),
    setPlaying: (isPlaying) => set({ isPlaying }),
    setExtent: (extentStart, extentEnd) => set({ extentStart, extentEnd }),
}));

/** Seed the time window from the event extent returned by the API. Called once
 *  after data loads. If the extent is missing, leaves current defaults. */
export function initWindowForExtent(minDate: string | null, maxDate: string | null) {
    if (!minDate || !maxDate) return;
    const min = parseInt(minDate.slice(0, 4), 10);
    const max = parseInt(maxDate.slice(0, 4), 10);
    if (Number.isNaN(min) || Number.isNaN(max)) return;
    const current = useTimeStore.getState();
    current.setExtent(min, max);
    if (!current.extentSeeded) {
        const g = useMapPrefsStore.getState().granularity;
        const width = GRANULARITY_WIDTH[g];
        const start = min;
        const end = Math.min(max, min + width);
        useTimeStore.setState({ windowStart: start, windowEnd: end, extentSeeded: true });
    }
}

/** Decide whether an event is visible under the current time window.
 *  - Undated event (sort_date == null): visible only when showUndated is true.
 *  - Point-in-time event: year is in [windowStart, windowEnd].
 *  - Range event: [sort_date, sort_end_date] overlaps [windowStart, windowEnd]. */
export function isEventInWindow(
    sortDate: string | null,
    sortEndDate: string | null,
    windowStart: number,
    windowEnd: number,
    showUndated: boolean,
): boolean {
    if (!sortDate) return showUndated;
    const start = parseInt(sortDate.slice(0, 4), 10);
    if (Number.isNaN(start)) return false;
    const end = sortEndDate ? parseInt(sortEndDate.slice(0, 4), 10) : start;
    return end >= windowStart && start <= windowEnd;
}
