import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Granularity, MapScope, Speed } from './types';
import type { EventType } from './eventTypes';

interface MapPrefs {
    scope: MapScope;
    granularity: Granularity;
    speed: Speed;
    loop: boolean;
    eventTypes: EventType[] | null; // null = all types, non-empty array = filter

    setScope: (s: MapScope) => void;
    setGranularity: (g: Granularity) => void;
    setSpeed: (s: Speed) => void;
    setLoop: (b: boolean) => void;
    setEventTypes: (t: EventType[] | null) => void;
}

export const useMapPrefsStore = create<MapPrefs>()(
    persist(
        (set) => ({
            scope: 'all',
            granularity: 'decade',
            speed: 1,
            loop: false,
            eventTypes: null,
            setScope: (scope) => set({ scope }),
            setGranularity: (granularity) => set({ granularity }),
            setSpeed: (speed) => set({ speed }),
            setLoop: (loop) => set({ loop }),
            setEventTypes: (eventTypes) => set({ eventTypes }),
        }),
        { name: 'legacy-graph-map-prefs-v1', version: 1 },
    ),
);
