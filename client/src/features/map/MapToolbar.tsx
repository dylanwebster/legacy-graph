import { useMemo, useState } from 'react';
import { Filter, Globe, User, Users } from 'lucide-react';
import { useFocalStore } from '@/shared/store/focalStore';
import { useGraphData } from '@/shared/api/hooks';
import { FocalPersonPicker, type FocalPickerNode } from '@/shared/components/FocalPersonPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { useMapPrefsStore } from './prefsStore';
import { EVENT_TYPES, TYPE_COLORS, type EventType } from './eventTypes';
import type { MapScope } from './types';

function rgbaCss([r, g, b, a]: [number, number, number, number]): string {
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function formatLabel(t: EventType): string {
    return t.replace(/_/g, ' ');
}

const SCOPES: ReadonlyArray<readonly [MapScope, typeof Globe, string]> = [
    ['all', Globe, 'Everyone'],
    ['focal', User, 'Focal person'],
    ['lineage', Users, 'Focal lineage'],
] as const;

/** Map view's TopBar action cluster: scope toggle, focal-person picker,
 *  and event-type filter. Rendered into the global TopBar via the
 *  TopBarActions portal in MapView. */
export function MapToolbar() {
    const focalPersonId = useFocalStore((s) => s.focalPersonId);
    const setFocal = useFocalStore((s) => s.setFocal);
    const { scope, setScope } = useMapPrefsStore();
    const eventTypes = useMapPrefsStore((s) => s.eventTypes);
    const setEventTypes = useMapPrefsStore((s) => s.setEventTypes);
    const [filterOpen, setFilterOpen] = useState(false);

    const { data: graphData } = useGraphData();

    const focalNodes = useMemo<FocalPickerNode[]>(() => {
        if (!graphData) return [];
        return graphData.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            sex: n.sex,
            birthYear: n.birthYear,
        }));
    }, [graphData]);

    const hasFocal = !!focalPersonId;

    function chooseScope(next: MapScope) {
        if ((next === 'focal' || next === 'lineage') && !hasFocal) return;
        setScope(next);
    }

    const isVisible = (t: EventType): boolean => (eventTypes === null ? true : eventTypes.includes(t));

    function toggle(t: EventType) {
        const current = eventTypes ?? [...EVENT_TYPES];
        const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
        if (next.length === EVENT_TYPES.length) setEventTypes(null);
        else setEventTypes(next);
    }

    function selectAll() {
        setEventTypes(null);
    }
    function selectNone() {
        setEventTypes([]);
    }

    const isFiltered = eventTypes !== null && eventTypes.length !== EVENT_TYPES.length;
    const filterCount = eventTypes === null ? EVENT_TYPES.length : eventTypes.length;

    return (
        <>
            <div className="w-px h-5 bg-border shrink-0 mx-1" />

            {/* Scope toggle — matches the dashboard's viz-mode segmented buttons */}
            <div className="flex gap-1 shrink-0">
                {SCOPES.map(([value, Icon, label]) => {
                    const active = scope === value;
                    const disabled = (value === 'focal' || value === 'lineage') && !hasFocal;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => chooseScope(value)}
                            disabled={disabled}
                            title={
                                disabled
                                    ? 'Pick a focal person to enable this scope'
                                    : label
                            }
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                                active
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            } ${disabled ? 'opacity-40 cursor-not-allowed hover:bg-muted' : ''}`}
                        >
                            <Icon className="h-3 w-3" />
                            {label}
                        </button>
                    );
                })}
            </div>

            {/* Focal person picker — shared store with the Graph page */}
            <FocalPersonPicker
                nodes={focalNodes}
                value={focalPersonId}
                onChange={setFocal}
            />

            {/* Event-type filter popover */}
            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={`h-8 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                            isFiltered
                                ? 'bg-primary/10 text-primary border border-primary/30'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        aria-label="Event type filter"
                    >
                        <Filter className="h-3.5 w-3.5" />
                        <span>Types</span>
                        {isFiltered && (
                            <span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 leading-none">
                                {filterCount}/{EVENT_TYPES.length}
                            </span>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-2">
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
                    <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
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
                </PopoverContent>
            </Popover>
        </>
    );
}
