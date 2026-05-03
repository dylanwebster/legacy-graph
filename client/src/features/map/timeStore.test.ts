import { describe, it, expect, beforeEach } from 'vitest';
import { useTimeStore, initWindowForExtent, isEventInWindow } from './timeStore';
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

describe('isEventInWindow', () => {
    it('hides undated events unless showUndated', () => {
        expect(isEventInWindow(null, null, 1900, 2000, false)).toBe(false);
        expect(isEventInWindow(null, null, 1900, 2000, true)).toBe(true);
    });

    it('shows point events whose year falls inside the window', () => {
        expect(isEventInWindow('1950-04-01', null, 1900, 2000, false)).toBe(true);
        expect(isEventInWindow('2050-01-01', null, 1900, 2000, false)).toBe(false);
        expect(isEventInWindow('1850-01-01', null, 1900, 2000, false)).toBe(false);
    });

    it('shows range events that overlap the window at either end', () => {
        // range straddles window-start
        expect(isEventInWindow('1890-01-01', '1910-01-01', 1900, 2000, false)).toBe(true);
        // range straddles window-end
        expect(isEventInWindow('1990-01-01', '2010-01-01', 1900, 2000, false)).toBe(true);
        // fully contained
        expect(isEventInWindow('1920-01-01', '1930-01-01', 1900, 2000, false)).toBe(true);
        // fully before window
        expect(isEventInWindow('1700-01-01', '1800-01-01', 1900, 2000, false)).toBe(false);
        // fully after window
        expect(isEventInWindow('2010-01-01', '2020-01-01', 1900, 2000, false)).toBe(false);
    });
});
