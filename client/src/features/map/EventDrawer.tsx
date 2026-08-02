import { useCallback, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { X, MapPin, Calendar, User, ChevronLeft } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useFocalStore } from '@/shared/store/focalStore';
import { TYPE_COLORS, type EventType } from './eventTypes';
import type { MapEvent } from './types';

interface Props {
    /** Events under the clicked point; null = drawer closed. */
    events: MapEvent[] | null;
    /** The event whose card is shown. null with events.length > 1 = list mode. */
    active: MapEvent | null;
    onSelect: (evt: MapEvent) => void;
    /** Return from a card to the co-located list (only offered when the list
     *  has more than one entry). */
    onBack: () => void;
    onClose: () => void;
}

function formatDateRange(e: MapEvent): string {
    if (!e.sort_date) return '—';
    const start = e.sort_date.slice(0, 10);
    if (!e.sort_end_date) return start;
    return `${start} – ${e.sort_end_date.slice(0, 10)}`;
}

function typeColorCss(type: string): string {
    const [r, g, b, a] = TYPE_COLORS[type as EventType] ?? [200, 200, 200, 220];
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

// Pixels of downward drag at which the mobile drawer auto-dismisses.
const DISMISS_THRESHOLD = 80;

export function EventDrawer({ events, active, onSelect, onBack, onClose }: Props) {
    const setFocal = useFocalStore((s) => s.setFocal);
    const [dragY, setDragY] = useState(0);
    const dragStartY = useRef<number | null>(null);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        dragStartY.current = e.clientY;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (dragStartY.current === null) return;
        const dy = e.clientY - dragStartY.current;
        // Only follow downward drags — upward gestures shouldn't push the
        // drawer above its docked position.
        setDragY(Math.max(0, dy));
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (dragStartY.current === null) return;
        const dy = e.clientY - dragStartY.current;
        dragStartY.current = null;
        if (dy > DISMISS_THRESHOLD) {
            setDragY(0);
            onClose();
        } else {
            setDragY(0);
        }
    }, [onClose]);

    if (!events || events.length === 0) return null;

    // A single-event list opens straight to the card; multi-event lists show
    // the card only after a selection (active), with a back affordance.
    const detail = active ?? (events.length === 1 ? events[0] : null);

    return (
        <>
            <div className="absolute inset-0 bg-black/20 md:bg-transparent" onClick={onClose} />
            <aside
                className="absolute md:left-auto md:right-0 md:top-0 md:h-full md:w-96 md:border-l left-0 right-0 bottom-0 h-[40vh] border-t md:border-t-0 border-border bg-card shadow-xl overflow-y-auto md:transform-none transition-transform md:transition-none"
                style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
            >
                {/* Mobile-only drag handle. Pointer Events let us track a single
                    finger or mouse drag without distinguishing touch vs mouse. */}
                <div
                    className="md:hidden flex items-center justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    aria-label="Drag to dismiss"
                    role="button"
                >
                    <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
                </div>

                {detail ? (
                    <>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <div className="flex items-center gap-1 min-w-0">
                                {events.length > 1 && (
                                    <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to event list">
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                )}
                                <h2 className="text-sm font-semibold capitalize truncate">{detail.type.replace('_', ' ')}</h2>
                            </div>
                            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="p-4 space-y-3 text-sm">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className="font-mono">{formatDateRange(detail)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                <span>{detail.place_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <Link to="/people/$id" params={{ id: detail.person_id }} className="text-primary hover:underline">
                                    {detail.person_name}
                                </Link>
                            </div>

                            <div className="pt-2 flex gap-2">
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                        setFocal(detail.person_id);
                                        onClose();
                                    }}
                                >
                                    Set as focal
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                    <Link to="/" onClick={() => setFocal(detail.person_id)}>
                                        Open on Graph
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <h2 className="text-sm font-semibold truncate">
                                {events.length} events at {events[0].place_name}
                            </h2>
                            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        <ul className="p-2">
                            {events.map((evt) => (
                                <li key={evt.id}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(evt)}
                                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left text-sm hover:bg-muted transition-colors"
                                    >
                                        <span
                                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: typeColorCss(evt.type) }}
                                            aria-hidden
                                        />
                                        <span className="capitalize shrink-0">{evt.type.replace('_', ' ')}</span>
                                        <span className="flex-1 min-w-0 truncate text-muted-foreground">{evt.person_name}</span>
                                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                                            {evt.sort_date ? evt.sort_date.slice(0, 4) : '—'}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </aside>
        </>
    );
}
