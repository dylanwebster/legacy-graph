import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer } from '@deck.gl/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useUIStore } from '@/shared/store/uiStore';
import { useFocalStore } from '@/shared/store/focalStore';
import { useMapEvents, useBasemapStatus } from './api';
import { registerPmtilesProtocol } from './pmtiles';
import { dayStyle } from './styles/day';
import { nightStyle } from './styles/night';
import { useMapPrefsStore } from './prefsStore';
import { buildMapLayers } from './layers/useMapLayers';
import { useTimeStore, initWindowForExtent } from './timeStore';
import { TimeSlider } from './TimeSlider';
import { MapToolbar } from './MapToolbar';
import { EventDrawer } from './EventDrawer';
import type { MapEvent } from './types';

const BASEMAP_TILES_URL = '/api/basemap/tiles';

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

    const basemap = useBasemapStatus();
    const events = useMapEvents({ scope, focalPersonId });
    const basemapAvailable = basemap.data?.available ?? false;
    const pmtilesUrl = basemapAvailable ? `${window.location.origin}${BASEMAP_TILES_URL}` : null;

    // Register pmtiles protocol once, before any map initialization uses it.
    useEffect(() => { registerPmtilesProtocol(); }, []);

    // Initialize MapLibre + deck.gl overlay on mount — only once the basemap is available.
    useEffect(() => {
        if (!basemapAvailable || !pmtilesUrl) return;
        if (!containerRef.current || mapRef.current) return;
        const style = theme === 'dark' ? nightStyle(pmtilesUrl) : dayStyle(pmtilesUrl);
        const map = new maplibregl.Map({
            container: containerRef.current,
            style,
            center: [0, 30],
            zoom: 2,
            minZoom: 1,
            maxZoom: 16,
            attributionControl: { compact: true },
        });
        map.on('zoom', () => setZoom(map.getZoom()));
        const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
        map.addControl(overlay as unknown as maplibregl.IControl);
        mapRef.current = map;
        overlayRef.current = overlay;

        return () => {
            map.remove();
            mapRef.current = null;
            overlayRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [basemapAvailable, pmtilesUrl]);

    // Swap style when theme toggles.
    useEffect(() => {
        if (!mapRef.current || !pmtilesUrl) return;
        const style = theme === 'dark' ? nightStyle(pmtilesUrl) : dayStyle(pmtilesUrl);
        mapRef.current.setStyle(style, { diff: false });
    }, [theme, pmtilesUrl]);

    // Seed time window from event extent on first successful load.
    useEffect(() => {
        if (events.data) initWindowForExtent(events.data.extent.minDate, events.data.extent.maxDate);
    }, [events.data]);

    // Fly to the extent of the current filtered data whenever scope or focal changes.
    // Skip the initial render (events.isFetched flips from false → true once).
    useEffect(() => {
        if (!mapRef.current || !events.data) return;
        const bbox = events.data.extent.bbox;
        if (!bbox) return;
        const [w, s, e, n] = bbox;
        mapRef.current.fitBounds([[w, s], [e, n]], { padding: 60, duration: 400, maxZoom: 10 });
    }, [scope, focalPersonId, events.data]);

    // Rebuild deck.gl layers whenever events / zoom / time window / scope change.
    const windowStart = useTimeStore((s) => s.windowStart);
    const windowEnd = useTimeStore((s) => s.windowEnd);
    const showUndated = useTimeStore((s) => s.showUndated);

    const layers = useMemo<Layer[]>(() => {
        return buildMapLayers({
            events: events.data?.events ?? [],
            zoom,
            windowStart,
            windowEnd,
            showUndated,
            scope,
            focalPersonId,
            theme,
            onEventClick: setOpenEvent,
        });
    }, [events.data, zoom, windowStart, windowEnd, showUndated, scope, focalPersonId, theme]);

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

    if (basemap.isFetched && !basemapAvailable) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-muted/20 p-6">
                <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm text-center">
                    <h2 className="text-lg font-semibold mb-2">Basemap not built</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        The Map View needs an offline PMTiles basemap to render. Build it once and the map will light up.
                    </p>
                    <pre className="bg-muted rounded px-3 py-2 text-left text-xs font-mono mb-4 overflow-x-auto">
npm run map:build -- --url &lt;world.pmtiles&gt;
                    </pre>
                    <p className="text-xs text-muted-foreground">
                        Point <code className="font-mono">--url</code> at a PMTiles world build (e.g. from{' '}
                        <a href="https://maps.protomaps.com" className="underline" target="_blank" rel="noreferrer">maps.protomaps.com</a>).
                        The file is saved to <code className="font-mono">~/.legacy-graph/basemap.pmtiles</code>. Reload this page when done.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative h-full w-full">
            <div ref={containerRef} className="absolute inset-0" />
            <MapToolbar />
            <TimeSlider />
            <EventDrawer event={openEvent} onClose={() => setOpenEvent(null)} />
        </div>
    );
}
