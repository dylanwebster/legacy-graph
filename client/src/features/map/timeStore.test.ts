import { describe, it, expect, beforeEach } from 'vitest';
import {
    useTimeStore,
    initWindowForExtent,
    parseEventYear,
    seedWindowFromUrl,
    advanceWindow,
    computeYearHistogram,
    STEP_YEARS,
    GRANULARITY_WIDTH,
} from './timeStore';
import { useMapPrefsStore } from './prefsStore';

describe('initWindowForExtent', () => {
    beforeEach(() => {
        useTimeStore.setState({
            extentSeeded: false,
            windowStart: 1900,
            windowEnd: 2000,
            extentStart: 1800,
            extentEnd: 2000,
        });
        useMapPrefsStore.setState({ granularity: 'decade' });
    });

    it('seeds a granularity-sized window on first call', () => {
        initWindowForExtent('1800-01-01', '2000-01-01');
        const s = useTimeStore.getState();
        expect(s.extentStart).toBe(1800);
        expect(s.extentEnd).toBe(2000);
        expect(s.windowStart).toBe(1800);
        expect(s.windowEnd).toBe(1820); // decade => 20-year width
        expect(s.extentSeeded).toBe(true);
    });

    it('uses 5-year width for granularity=year', () => {
        useMapPrefsStore.setState({ granularity: 'year' });
        initWindowForExtent('1900-06-01', '2000-01-01');
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1900);
        expect(s.windowEnd).toBe(1905);
    });

    it('uses 100-year width for granularity=century', () => {
        useMapPrefsStore.setState({ granularity: 'century' });
        initWindowForExtent('1700-01-01', '2000-01-01');
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1700);
        expect(s.windowEnd).toBe(1800);
    });

    it('clamps the seed window to the extent maximum', () => {
        initWindowForExtent('1990-01-01', '2000-01-01');
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1990);
        expect(s.windowEnd).toBe(2000); // min(2000, 1990 + 20)
    });

    it('does not reset the user window on subsequent calls', () => {
        initWindowForExtent('1800-01-01', '2000-01-01');
        useTimeStore.setState({ windowStart: 1900, windowEnd: 1950 });
        initWindowForExtent('1700-01-01', '2050-01-01');
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1900);
        expect(s.windowEnd).toBe(1950);
        // …but extent does update so the slider bounds reflect new data.
        expect(s.extentStart).toBe(1700);
        expect(s.extentEnd).toBe(2050);
    });

    it('is a no-op when minDate or maxDate is null', () => {
        const before = useTimeStore.getState();
        initWindowForExtent(null, null);
        const after = useTimeStore.getState();
        expect(after.extentStart).toBe(before.extentStart);
        expect(after.extentEnd).toBe(before.extentEnd);
        expect(after.extentSeeded).toBe(false);
    });
});

describe('step and width constants', () => {
    it('playback/arrow step is exactly one granularity unit (spec §6.11)', () => {
        // The UI labels the step select "1 yr / 10 yr / 100 yr" — these
        // constants are the contract behind those labels.
        expect(STEP_YEARS).toEqual({ year: 1, decade: 10, century: 100 });
    });

    it('seed window width stays the granularity-sized default', () => {
        expect(GRANULARITY_WIDTH).toEqual({ year: 5, decade: 20, century: 100 });
    });
});

describe('seedWindowFromUrl', () => {
    beforeEach(() => {
        useTimeStore.setState({
            extentSeeded: false,
            windowStart: 1900,
            windowEnd: 2000,
            extentStart: 1800,
            extentEnd: 2000,
        });
        useMapPrefsStore.setState({ granularity: 'decade' });
    });

    it('applies the window and marks it seeded', () => {
        seedWindowFromUrl(1880, 1900);
        const s = useTimeStore.getState();
        expect(s.windowStart).toBe(1880);
        expect(s.windowEnd).toBe(1900);
        expect(s.extentSeeded).toBe(true);
    });

    it('survives the extent init that follows the first data load (deep-link contract)', () => {
        seedWindowFromUrl(1880, 1900);
        initWindowForExtent('1700-01-01', '2000-01-01');
        const s = useTimeStore.getState();
        // Window from the URL is preserved…
        expect(s.windowStart).toBe(1880);
        expect(s.windowEnd).toBe(1900);
        // …while the extent still updates to the data.
        expect(s.extentStart).toBe(1700);
        expect(s.extentEnd).toBe(2000);
    });
});

describe('advanceWindow', () => {
    it('advances the window by the step, preserving width', () => {
        expect(advanceWindow(1900, 1920, 1800, 2000, 10, false)).toEqual({
            windowStart: 1910,
            windowEnd: 1930,
            done: false,
        });
    });

    it('clamps the step to the window width so playback never skips years', () => {
        // century step with a 5-year window advances 5 years, not 100.
        expect(advanceWindow(1900, 1905, 1800, 2000, 100, false)).toEqual({
            windowStart: 1905,
            windowEnd: 1910,
            done: false,
        });
    });

    it('stops at the extent end when not looping', () => {
        expect(advanceWindow(1985, 1995, 1800, 2000, 10, false)).toEqual({
            windowStart: 1990,
            windowEnd: 2000,
            done: true,
        });
    });

    it('wraps to the extent start when looping', () => {
        expect(advanceWindow(1985, 1995, 1800, 2000, 10, true)).toEqual({
            windowStart: 1800,
            windowEnd: 1810,
            done: false,
        });
    });
});

describe('computeYearHistogram', () => {
    it('bins point events by year', () => {
        const events = [
            { startYear: 1800, endYear: 1800 },
            { startYear: 1801, endYear: 1801 },
            { startYear: 1899, endYear: 1899 },
        ];
        const h = computeYearHistogram(events, 1800, 1899, 10);
        expect(h.counts).toHaveLength(10);
        expect(h.counts[0]).toBe(2); // 1800 + 1801 in the first decade bin
        expect(h.counts[9]).toBe(1); // 1899 in the last bin
        expect(h.max).toBe(2);
    });

    it('counts range events in every bin they overlap (matches window semantics)', () => {
        const events = [{ startYear: 1800, endYear: 1839 }];
        const h = computeYearHistogram(events, 1800, 1899, 10);
        expect(h.counts.slice(0, 4)).toEqual([1, 1, 1, 1]);
        expect(h.counts[4]).toBe(0);
    });

    it('ignores undated events and handles empty input', () => {
        const h = computeYearHistogram([{ startYear: null, endYear: null }], 1800, 1899, 10);
        expect(h.max).toBe(0);
        expect(h.counts.every((c) => c === 0)).toBe(true);
        expect(computeYearHistogram([], 1800, 1899, 10).counts).toHaveLength(10);
    });
});

describe('parseEventYear', () => {
    it('parses the year from an ISO date string', () => {
        expect(parseEventYear('1950-04-01')).toBe(1950);
        expect(parseEventYear('0850-01-01')).toBe(850);
    });

    it('returns null for null or malformed input', () => {
        expect(parseEventYear(null)).toBeNull();
        expect(parseEventYear('unknown')).toBeNull();
    });
});

