import { useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Calendar, MapPin, ChevronRight, BookOpen, Building2 } from 'lucide-react';
import { formatPlaceDisplay } from '@/shared/lib/places';
import { EVENT_ICONS, EVENT_LABELS } from '../eventTypeConfig';

export function PersonTimeline({
    timeline,
    onEditEvent,
}: {
    timeline: Array<Record<string, unknown>>;
    onEditEvent: (event: Record<string, unknown>) => void;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: timeline.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 80,
        overscan: 5,
    });

    if (timeline.length === 0) {
        return (
            <div className="flex-1 overflow-y-auto p-8 text-center text-muted-foreground text-sm">
                No events recorded yet.
            </div>
        );
    }

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
            className="px-4 py-3"
        >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const item = timeline[virtualItem.index];
                const isGap = item.type === 'gap';
                const isUnknownDateHeader = item.type === 'unknown_date_header';
                // Timeline items: { type, sort_date, data: LegacyEvent } for events.
                // Actual fields (date, location, description) are nested in 'data'.
                const details = (item.data as Record<string, unknown>) ?? item;
                const IconComp = EVENT_ICONS[String(details.type ?? item.type)] ?? Calendar;

                return (
                    <div
                        key={virtualItem.key}
                        data-index={virtualItem.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className="pb-3"
                    >
                        {isUnknownDateHeader ? (
                            <div className="flex items-center gap-2 py-2 px-3">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Undated Events</span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                        ) : isGap ? (
                            <div className="flex items-center gap-2 py-2 px-3">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {item.years ? `${item.years} year gap` : '—'}
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>
                        ) : item.type === 'story' ? (
                            <Link
                                to="/stories/$id"
                                params={{ id: String((item as Record<string, unknown>).id ?? '').replace(/\.md$/, '') }}
                                className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors group"
                            >
                                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20">
                                    <BookOpen className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{String((item as Record<string, unknown>).title ?? 'Story')}</span>
                                        {!!(item as Record<string, unknown>).sort_date && (
                                            <span className="text-xs text-muted-foreground font-mono">{String((item as Record<string, unknown>).sort_date)}</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">Mentioned in this story</p>
                                </div>
                                <ChevronRight className="h-4 w-4 text-muted-foreground self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                            </Link>
                        ) : (
                            <button
                                className="w-full flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors group text-left"
                                onClick={() => onEditEvent(item)}
                            >
                                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10">
                                    <IconComp className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{EVENT_LABELS[String(details.type ?? item.type ?? '')] ?? String(details.type ?? item.type ?? '')}</span>
                                        {!!details.date && (
                                            <span className="text-xs text-muted-foreground font-mono">{String(details.date)}</span>
                                        )}
                                    </div>
                                    {!!details.location && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                            <MapPin className="h-3 w-3" />
                                            <span className="truncate">
                                                {typeof details.location === 'object' && details.location !== null
                                                    ? formatPlaceDisplay(details.location as import('@/shared/api/people').Place)
                                                    : String(details.location)}
                                            </span>
                                        </div>
                                    )}
                                    {!!details.site_name && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                            <Building2 className="h-3 w-3" />
                                            <span className="truncate">{String(details.site_name)}</span>
                                        </div>
                                    )}
                                    {!!details.description && (
                                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{String(details.description)}</p>
                                    )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-muted-foreground self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
        </div>
    );
}
