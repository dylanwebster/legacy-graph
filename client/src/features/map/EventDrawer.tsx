import { useCallback, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { X, MapPin, Calendar, User } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useFocalStore } from '@/shared/store/focalStore';
import type { MapEvent } from './types';

interface Props {
    event: MapEvent | null;
    onClose: () => void;
}

function formatDateRange(e: MapEvent): string {
    if (!e.sort_date) return '—';
    const start = e.sort_date.slice(0, 10);
    if (!e.sort_end_date) return start;
    return `${start} – ${e.sort_end_date.slice(0, 10)}`;
}

// Pixels of downward drag at which the mobile drawer auto-dismisses.
const DISMISS_THRESHOLD = 80;

export function EventDrawer({ event, onClose }: Props) {
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

    if (!event) return null;

    return (
        <>
            <div className="absolute inset-0 bg-black/20 md:bg-transparent" onClick={onClose} />
            <aside
                className="absolute md:right-0 md:top-0 md:h-full md:w-96 md:border-l left-0 right-0 bottom-0 h-[40vh] border-t md:border-t-0 border-border bg-card shadow-xl overflow-y-auto md:transform-none transition-transform md:transition-none"
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
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h2 className="text-sm font-semibold capitalize">{event.type.replace('_', ' ')}</h2>
                    <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="p-4 space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono">{formatDateRange(event)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>{event.place_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <Link to="/people/$id" params={{ id: event.person_id }} className="text-primary hover:underline">
                            {event.person_name}
                        </Link>
                    </div>

                    <div className="pt-2 flex gap-2">
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                                setFocal(event.person_id);
                                onClose();
                            }}
                        >
                            Set as focal
                        </Button>
                        <Link
                            to="/"
                            onClick={() => setFocal(event.person_id)}
                        >
                            <Button size="sm" variant="outline">Open on Graph</Button>
                        </Link>
                    </div>
                </div>
            </aside>
        </>
    );
}
