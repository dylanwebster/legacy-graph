import { useState } from 'react';
import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import { useMapPrefsStore } from './prefsStore';
import { EVENT_TYPES, TYPE_COLORS, type EventType } from './eventTypes';

function rgbaCss([r, g, b, a]: [number, number, number, number]): string {
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function formatLabel(t: EventType): string {
    return t.replace(/_/g, ' ');
}

export function MapLegend() {
    const eventTypes = useMapPrefsStore((s) => s.eventTypes);
    const setEventTypes = useMapPrefsStore((s) => s.setEventTypes);
    const [open, setOpen] = useState(false);

    // null = all types visible; an array = explicit filter set (empty = none).
    const isVisible = (t: EventType): boolean => (eventTypes === null ? true : eventTypes.includes(t));

    function toggle(t: EventType) {
        const current = eventTypes ?? [...EVENT_TYPES];
        const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
        // Collapse to null when every type is selected — keeps the URL/store
        // shorter and means the heatmap is unfiltered.
        if (next.length === EVENT_TYPES.length) setEventTypes(null);
        else setEventTypes(next);
    }

    function selectAll() {
        setEventTypes(null);
    }
    function selectNone() {
        setEventTypes([]);
    }

    const filterCount = eventTypes === null ? EVENT_TYPES.length : eventTypes.length;
    const isFiltered = eventTypes !== null && eventTypes.length !== EVENT_TYPES.length;

    return (
        <div className="absolute top-4 right-4 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card/90 backdrop-blur-sm shadow-sm">
            <button
                type="button"
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium w-full"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="map-legend-panel"
            >
                <Filter className="h-3.5 w-3.5" />
                <span>Legend</span>
                {isFiltered && (
                    <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                        {filterCount}/{EVENT_TYPES.length}
                    </span>
                )}
                <span className="flex-1" />
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {open && (
                <div id="map-legend-panel" className="border-t border-border p-2 max-h-[60vh] overflow-y-auto">
                    <div className="flex gap-1 mb-2">
                        <button
                            type="button"
                            onClick={selectAll}
                            className="flex-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={selectNone}
                            className="flex-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
                        >
                            None
                        </button>
                    </div>
                    <ul className="space-y-1">
                        {EVENT_TYPES.map((t) => {
                            const visible = isVisible(t);
                            return (
                                <li key={t}>
                                    <label className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted text-xs select-none">
                                        <input
                                            type="checkbox"
                                            className="h-3 w-3"
                                            checked={visible}
                                            onChange={() => toggle(t)}
                                        />
                                        <span
                                            className="inline-block h-3 w-3 rounded-full border border-border shrink-0"
                                            style={{ backgroundColor: rgbaCss(TYPE_COLORS[t]) }}
                                            aria-hidden
                                        />
                                        <span className="capitalize">{formatLabel(t)}</span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}
