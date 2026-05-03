import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useUIStore } from '@/shared/store/uiStore';
import { useFocalStore } from '@/shared/store/focalStore';
import { useMapEvents } from './api';
import { dayStyle } from './styles/day';
import { nightStyle } from './styles/night';
import { useMapPrefsStore } from './prefsStore';
import { buildMapLayers, jitterOffset, type JitteredEvent } from './layers/buildMapLayers';
import { BASEMAP_MAX_ZOOM } from './constants';
import { useTimeStore, initWindowForExtent, isEventInWindow } from './timeStore';
import { TimeSlider } from './TimeSlider';
import { MapToolbar } from './MapToolbar';
import { EventDrawer } from './EventDrawer';
import type { MapEvent } from './types';

export function MapView() {
    const theme = useUIStore((s) => s.theme);
    const focalPersonId = useFocalStore((s) => s.focalPersonId);
    const setFocal = useFocalStore((s) => s.setFocal);
    const scope = useMapPrefsStore((s) => s.scope);
    const setScope = useMapPrefsStore((s) => s.setScope);
    const setGranularity = useMapPrefsStore((s) => s.setGranularity);
    const setSpeed = useMapPrefsStore((s) => s.setSpeed);
    const setLoop = useMapPrefsStore((s) => s.setLoop);
    const setPlaying = useTimeStore((s) => s.setPlaying);
    const setWindow = useTimeStore((s) => s.setWindow);
    const navigate = useNavigate({ from: '/map' });
    const search = useSearch({ from: '/map' });

    // On mount: apply URL params to stores. Runs once — further URL changes come from us.
    // ?event=<id>: opens the drawer once when events.data first becomes truthy AND the URL
    // value differs from the last-opened id (Phase C6). MapView stays mounted across in-app
    // nav, so the gate must key on the URL value, not a one-shot flag.
    const didBootFromUrl = useRef(false);
    useEffect(() => {
        if (didBootFromUrl.current) return;
        didBootFromUrl.current = true;
        if (search.scope) setScope(search.scope);
        if (search.person) setFocal(search.person);
        if (search.g) setGranularity(search.g);
        if (search.speed !== undefined) setSpeed(search.speed);
        if (search.loop !== undefined) setLoop(search.loop === 1);
        if (search.t !== undefined && search.t_end !== undefined) setWindow(search.t, search.t_end);
        if (search.play === 1) setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const overlayRef = useRef<MapboxOverlay | null>(null);
    const [zoom, setZoom] = useState(2);
    const [openEvent, setOpenEvent] = useState<MapEvent | null>(null);

    const events = useMapEvents({ scope, focalPersonId });

    // Initialize MapLibre + deck.gl overlay on mount.
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const style = theme === 'dark' ? nightStyle() : dayStyle();
        const map = new maplibregl.Map({
            container: containerRef.current,
            style,
            center: [0, 30],
            zoom: 2,
            minZoom: 0,
            maxZoom: BASEMAP_MAX_ZOOM,
            attributionControl: { compact: true },
        });
        // Throttle zoom updates: the layer crossfade only has thresholds at a few
        // discrete zoom levels, so we don't need per-frame resolution. Round to 0.25
        // and only setState when the bucketed value changes — prevents per-frame
        // layer rebuilds during a pinch/wheel gesture.
        const onZoom = () => {
            const z = Math.round(map.getZoom() * 4) / 4;
            setZoom((prev) => (prev === z ? prev : z));
        };
        map.on('zoom', onZoom);
        map.on('zoomend', onZoom);
        const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
        map.addControl(overlay as unknown as maplibregl.IControl);
        mapRef.current = map;
        overlayRef.current = overlay;
        // Visual-regression test harness hook (tests/e2e/map-snapshots.spec.ts).
        // Exposed unconditionally — harmless in production, avoids env-dependent
        // diverging behaviour between dev and CI snapshot runs.
        (window as unknown as { __map?: maplibregl.Map }).__map = map;

        return () => {
            (window as unknown as { __map?: maplibregl.Map }).__map = undefined;
            map.remove();
            mapRef.current = null;
            overlayRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Swap style when theme toggles.
    useEffect(() => {
        if (!mapRef.current) return;
        const style = theme === 'dark' ? nightStyle() : dayStyle();
        mapRef.current.setStyle(style, { diff: true });
    }, [theme]);

    // Seed time window from event extent on first successful load.
    useEffect(() => {
        if (events.data) initWindowForExtent(events.data.extent.minDate, events.data.extent.maxDate);
    }, [events.data]);

    // Fly to the extent of the current filtered data whenever the bbox actually changes.
    // Idempotent React Query refetches produce a new events.data reference but identical
    // bytes — we don't want those to yank the user back. Key the guard on
    // `${scope}:${focalPersonId}:${events.length}` so that a hot-patch with new geocoded
    // events (count changes) does refit, but a refetch with identical results does not.
    const lastFlownToKey = useRef<string | null>(null);
    useEffect(() => {
        if (!mapRef.current || !events.data) return;
        const key = `${scope}:${focalPersonId ?? '_'}:${events.data.events.length}`;
        if (lastFlownToKey.current === key) return;
        const bbox = events.data.extent.bbox;
        if (!bbox) return;
        const [w, s, e, n] = bbox;
        mapRef.current.fitBounds([[w, s], [e, n]], { padding: 60, duration: 400, maxZoom: BASEMAP_MAX_ZOOM });
        lastFlownToKey.current = key;
    }, [scope, focalPersonId, events.data]);

    // Rebuild deck.gl layers whenever events / zoom / time window / scope change.
    const windowStart = useTimeStore((s) => s.windowStart);
    const windowEnd = useTimeStore((s) => s.windowEnd);
    const showUndated = useTimeStore((s) => s.showUndated);

    // Pre-jitter event positions once per data refresh. Keyed on dataUpdatedAt
    // (not events.data) — React Query produces a new reference on every refetch
    // even when bytes are identical, which would otherwise re-jitter unnecessarily.
    const jitteredEvents = useMemo<JitteredEvent[]>(() => {
        const all = events.data?.events ?? [];
        return all.map((e) => {
            const [dx, dy] = jitterOffset(e.id);
            return { ...e, jitteredLng: e.lng + dx, jitteredLat: e.lat + dy };
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events.dataUpdatedAt]);

    // Pre-filter focal-scope events once per data/scope/focal change.
    const personEvents = useMemo<JitteredEvent[] | null>(() => {
        if (scope !== 'focal' || !focalPersonId) return null;
        return jitteredEvents
            .filter((e) => e.person_id === focalPersonId && e.sort_date)
            .sort((a, b) => (a.sort_date ?? '').localeCompare(b.sort_date ?? ''));
    }, [jitteredEvents, scope, focalPersonId]);

    // Time-window filter lifted out of buildMapLayers so the resulting array's
    // reference is stable across zoom changes. With a stable `data` reference,
    // deck.gl skips GPU attribute regen on layer re-build.
    const visible = useMemo<JitteredEvent[]>(() => {
        return jitteredEvents.filter((e) =>
            isEventInWindow(e.sort_date, e.sort_end_date, windowStart, windowEnd, showUndated),
        );
    }, [jitteredEvents, windowStart, windowEnd, showUndated]);

    const layers = useMemo<Layer[]>(() => {
        return buildMapLayers({
            visible,
            personEvents,
            zoom,
            scope,
            focalPersonId,
            theme,
            onEventClick: setOpenEvent,
        });
    }, [visible, personEvents, zoom, scope, focalPersonId, theme]);

    useEffect(() => {
        overlayRef.current?.setProps({ layers });
    }, [layers]);

    // Write current state back to the URL (debounced). Keeps share/reload identical.
    const granularity = useMapPrefsStore((s) => s.granularity);
    const speed = useMapPrefsStore((s) => s.speed);
    const loop = useMapPrefsStore((s) => s.loop);
    const isPlaying = useTimeStore((s) => s.isPlaying);
    useEffect(() => {
        if (!didBootFromUrl.current) return;
        const t = setTimeout(() => {
            navigate({
                to: '/map',
                search: {
                    scope: scope === 'all' ? undefined : scope,
                    person: focalPersonId ?? undefined,
                    g: granularity === 'decade' ? undefined : granularity,
                    speed: speed === 1 ? undefined : speed,
                    loop: loop ? 1 : undefined,
                    play: isPlaying ? 1 : undefined,
                    t: Math.round(windowStart),
                    t_end: Math.round(windowEnd),
                    event: search.event,
                },
                replace: true,
            });
        }, 200);
        return () => clearTimeout(t);
    }, [scope, focalPersonId, granularity, speed, loop, isPlaying, windowStart, windowEnd, navigate, search.event]);

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />
            <MapToolbar />
            <TimeSlider />
            <EventDrawer event={openEvent} onClose={() => setOpenEvent(null)} />
        </div>
    );
}
