import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
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
import { MapLegend } from './MapLegend';
import { EventDrawer } from './EventDrawer';
import type { MapEvent } from './types';
import type { EventType } from './eventTypes';

export function MapView() {
    const theme = useUIStore((s) => s.theme);
    const focalPersonId = useFocalStore((s) => s.focalPersonId);
    const setFocal = useFocalStore((s) => s.setFocal);
    const scope = useMapPrefsStore((s) => s.scope);
    const eventTypes = useMapPrefsStore((s) => s.eventTypes);
    const setScope = useMapPrefsStore((s) => s.setScope);
    const setGranularity = useMapPrefsStore((s) => s.setGranularity);
    const setSpeed = useMapPrefsStore((s) => s.setSpeed);
    const setLoop = useMapPrefsStore((s) => s.setLoop);
    const setPlaying = useTimeStore((s) => s.setPlaying);
    const setWindow = useTimeStore((s) => s.setWindow);
    const navigate = useNavigate({ from: '/map' });
    const search = useSearch({ from: '/map' });

    // On mount: apply URL params to stores. Runs once — further URL changes come from us.
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

    // Pre-jitter event positions once per data refresh.
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

    // Lift the type-filter set into a stable Set so filtering is O(1) per event
    // and we don't reallocate on every render.
    const typeFilter = useMemo<Set<EventType> | null>(() => {
        if (eventTypes === null) return null;
        return new Set(eventTypes);
    }, [eventTypes]);

    // Time-window + event-type filter. Lifted out of buildMapLayers so the
    // resulting array reference is stable across zoom changes.
    const visible = useMemo<JitteredEvent[]>(() => {
        return jitteredEvents.filter((e) => {
            if (typeFilter && !typeFilter.has(e.type as EventType)) return false;
            return isEventInWindow(e.sort_date, e.sort_end_date, windowStart, windowEnd, showUndated);
        });
    }, [jitteredEvents, windowStart, windowEnd, showUndated, typeFilter]);

    // Heatmap radius is zoom-interpolated: 30 px at zoom 0 → 60 px at zoom 5.
    // Computed here (not inside buildMapLayers) so the layer prop changes only
    // when the bucketed `zoom` state changes, not per draw frame.
    const heatmapRadiusPixels = useMemo(() => {
        const t = Math.max(0, Math.min(1, zoom / 5));
        return 30 + (60 - 30) * t;
    }, [zoom]);

    // Defer `onOpenEvent` declaration: declared below as a useCallback. We
    // build layers off a stable click ref so the layer rebuild deps stay tight.
    const clickRef = useRef<(evt: MapEvent) => void>(() => {});

    const layers = useMemo<Layer[]>(() => {
        return buildMapLayers({
            visible,
            personEvents,
            zoom,
            scope,
            focalPersonId,
            theme,
            heatmapRadiusPixels,
            onEventClick: (evt) => clickRef.current(evt),
        });
    }, [visible, personEvents, zoom, scope, focalPersonId, theme, heatmapRadiusPixels]);

    useEffect(() => {
        overlayRef.current?.setProps({ layers });
    }, [layers]);

    // Open drawer once when ?event=<id> is in the URL on first data load.
    // Keyed on the URL value so we don't re-open after the user closes.
    const lastOpenedEventId = useRef<string | null>(null);
    useEffect(() => {
        if (!events.data) return;
        const id = search.event;
        if (!id || lastOpenedEventId.current === id) return;
        const target = events.data.events.find((e) => e.id === id);
        if (!target) return;
        lastOpenedEventId.current = id;
        setOpenEvent(target);
    }, [events.data, search.event]);

    // Drawer open/close also writes ?event= synchronously to avoid a race where
    // the debounced URL writer below re-emits the stale value after close.
    const onCloseDrawer = useCallback(() => {
        setOpenEvent(null);
        lastOpenedEventId.current = null;
        navigate({
            to: '/map',
            search: (prev) => ({ ...prev, event: undefined }),
            replace: true,
        });
    }, [navigate]);

    const onOpenEvent = useCallback((evt: MapEvent) => {
        setOpenEvent(evt);
        lastOpenedEventId.current = evt.id;
        navigate({
            to: '/map',
            search: (prev) => ({ ...prev, event: evt.id }),
            replace: true,
        });
    }, [navigate]);

    // Route deck.gl pin clicks through onOpenEvent (which also writes ?event=
    // synchronously). Done via a ref so layer rebuilds don't depend on the
    // navigate-derived callback identity.
    useEffect(() => {
        clickRef.current = onOpenEvent;
    }, [onOpenEvent]);

    // Write current state back to the URL (debounced). Keeps share/reload identical.
    const granularity = useMapPrefsStore((s) => s.granularity);
    const speed = useMapPrefsStore((s) => s.speed);
    const loop = useMapPrefsStore((s) => s.loop);
    const isPlaying = useTimeStore((s) => s.isPlaying);
    const extentStart = useTimeStore((s) => s.extentStart);
    const extentEnd = useTimeStore((s) => s.extentEnd);
    useEffect(() => {
        if (!didBootFromUrl.current) return;
        const t = setTimeout(() => {
            // Omit t/t_end when the window equals the full extent — keeps the
            // URL clean for users who haven't scrubbed.
            const atExtent =
                Math.round(windowStart) === Math.round(extentStart) &&
                Math.round(windowEnd) === Math.round(extentEnd);
            navigate({
                to: '/map',
                search: (prev) => ({
                    ...prev,
                    scope: scope === 'all' ? undefined : scope,
                    person: focalPersonId ?? undefined,
                    g: granularity === 'decade' ? undefined : granularity,
                    speed: speed === 1 ? undefined : speed,
                    loop: loop ? 1 : undefined,
                    play: isPlaying ? 1 : undefined,
                    t: atExtent ? undefined : Math.round(windowStart),
                    t_end: atExtent ? undefined : Math.round(windowEnd),
                }),
                replace: true,
            });
        }, 200);
        return () => clearTimeout(t);
    }, [scope, focalPersonId, granularity, speed, loop, isPlaying, windowStart, windowEnd, extentStart, extentEnd, navigate]);

    const isLoading = events.isLoading || (events.isFetching && !events.data);
    const hasNoEvents = !!events.data && events.data.events.length === 0;

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="h-full w-full" />
            <MapToolbar />
            <MapLegend />
            <TimeSlider />
            {isLoading && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-md border border-border bg-card/80 backdrop-blur-sm px-4 py-2 text-sm text-muted-foreground shadow-sm">
                        Loading events…
                    </div>
                </div>
            )}
            {hasNoEvents && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="pointer-events-auto max-w-sm rounded-lg border border-border bg-card/95 shadow-lg p-5 text-sm text-center">
                        <p className="font-medium">No events with coordinates yet</p>
                        <p className="mt-1 text-muted-foreground">
                            Geocode the events in your tree to see them here.
                        </p>
                        <Link to="/settings" className="mt-3 inline-block text-primary hover:underline">
                            Go to Settings → Geocoding
                        </Link>
                    </div>
                </div>
            )}
            <EventDrawer event={openEvent} onClose={onCloseDrawer} />
        </div>
    );
}
