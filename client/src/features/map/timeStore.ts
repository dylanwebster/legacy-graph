import { create } from 'zustand';
import { useMapPrefsStore } from './prefsStore';
import type { Granularity } from './types';

/** Default window WIDTH seeded per granularity (initWindowForExtent). */
export const GRANULARITY_WIDTH: Record<Granularity, number> = {
    year: 5,
    decade: 20,
    century: 100,
};

/** How far one playback tick / arrow key moves the window: exactly one
 *  granularity unit, matching the "1 yr / 10 yr / 100 yr" step labels.
 *  Distinct from GRANULARITY_WIDTH — step ≠ default width (spec §6.11). */
export const STEP_YEARS: Record<Granularity, number> = {
    year: 1,
    decade: 10,
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

/** Boot-time window seed from URL params (?t=&t_end=). Marks the window as
 *  seeded so the extent init that follows the first data load doesn't
 *  overwrite the deep-linked window. */
export function seedWindowFromUrl(start: number, end: number) {
    useTimeStore.setState({ windowStart: start, windowEnd: end, extentSeeded: true });
}

export interface AdvanceResult {
    windowStart: number;
    windowEnd: number;
    /** True when playback reached the extent end (caller should stop). */
    done: boolean;
}

/** One playback tick: slide the window forward by stepYears, preserving its
 *  width. The step is clamped to the window width so playback never jumps
 *  past years the window has not shown (a 100-yr step with a 5-yr window
 *  would otherwise skip 95 of every 100 years). */
export function advanceWindow(
    windowStart: number,
    windowEnd: number,
    extentStart: number,
    extentEnd: number,
    stepYears: number,
    loop: boolean,
): AdvanceResult {
    const width = windowEnd - windowStart;
    const step = Math.min(stepYears, width);
    const nextStart = windowStart + step;
    const nextEnd = nextStart + width;
    if (nextEnd > extentEnd) {
        if (loop) {
            return { windowStart: extentStart, windowEnd: extentStart + width, done: false };
        }
        return { windowStart: extentEnd - width, windowEnd: extentEnd, done: true };
    }
    return { windowStart: nextStart, windowEnd: nextEnd, done: false };
}

export interface YearHistogram {
    counts: number[];
    max: number;
}

/** Bin event counts across [extentStart, extentEnd] for the slider's context
 *  strip. Range events count in every bin their [startYear, endYear] interval
 *  overlaps — the same overlap semantics the window filter uses — and undated
 *  events are skipped (they are not on the timeline). */
export function computeYearHistogram(
    events: ReadonlyArray<{ startYear: number | null; endYear: number | null }>,
    extentStart: number,
    extentEnd: number,
    binCount: number,
): YearHistogram {
    const counts = new Array<number>(binCount).fill(0);
    const span = Math.max(1, extentEnd - extentStart + 1);
    const binWidth = span / binCount;
    for (const e of events) {
        if (e.startYear === null) continue;
        const end = e.endYear ?? e.startYear;
        const firstBin = Math.max(0, Math.floor((e.startYear - extentStart) / binWidth));
        const lastBin = Math.min(binCount - 1, Math.floor((end - extentStart) / binWidth));
        for (let b = firstBin; b <= lastBin; b++) counts[b]++;
    }
    let max = 0;
    for (const c of counts) if (c > max) max = c;
    return { counts, max };
}

/** Parse the year out of an ISO-ish date string ("1950-04-01" → 1950).
 *  Returns null for null/malformed input. Done once per event on data load
 *  (see prepareEvents) so the per-frame window filter is pure number math. */
export function parseEventYear(date: string | null): number | null {
    if (!date) return null;
    const y = parseInt(date.slice(0, 4), 10);
    return Number.isNaN(y) ? null : y;
}

