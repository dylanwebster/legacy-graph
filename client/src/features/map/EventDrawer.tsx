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

export function EventDrawer({ event, onClose }: Props) {
    const setFocal = useFocalStore((s) => s.setFocal);

    if (!event) return null;

    return (
        <>
            <div className="absolute inset-0 bg-black/20 md:bg-transparent" onClick={onClose} />
            <aside className="absolute md:right-0 md:top-0 md:h-full md:w-96 md:border-l left-0 right-0 bottom-0 h-1/2 border-t md:border-t-0 border-border bg-card shadow-xl overflow-y-auto">
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
