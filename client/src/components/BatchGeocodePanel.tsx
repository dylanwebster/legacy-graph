import type { BatchGeocodeResult } from '@/api/client';
import type { Place } from '@/api/people';
import { useGeocodeStore, type SortBy, type SortOrder } from '@/store/geocodeStore';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { PlaceSearchCombobox } from '@/components/PlaceSearchCombobox';
import { formatPlaceDisplay, formatCoordinates } from '@/lib/placeUtils';
import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import {
    RefreshCw, Loader2, Download,
    MapPin, Search, ArrowRight, MapPinned, Pencil, RotateCcw, Landmark,
    ArrowUpDown, ChevronUp, ChevronDown, X,
} from 'lucide-react';
import { toast } from 'sonner';

type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low' | 'unmatched';

function sortResults(results: BatchGeocodeResult[], sortBy: SortBy, sortOrder: SortOrder): BatchGeocodeResult[] {
    const sorted = [...results];
    const dir = sortOrder === 'asc' ? 1 : -1;
    switch (sortBy) {
        case 'alpha':
            sorted.sort((a, b) => dir * a.locationString.replace(/^[\s,._-]+/, '').localeCompare(b.locationString.replace(/^[\s,._-]+/, '')));
            break;
        case 'events':
            sorted.sort((a, b) => dir * (a.occurrences.length - b.occurrences.length));
            break;
    }
    return sorted;
}

function escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function BatchGeocodePanel() {
    const store = useGeocodeStore();
    const queryClient = useQueryClient();
    const [isApplying, setIsApplying] = useState(false);
    const [inputQuery, setInputQuery] = useState(store.searchQuery);
    const [editingRow, setEditingRow] = useState<string | null>(null);
    // Use state-based ref so virtualizer re-renders when dialog mounts/unmounts the scroll container
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

    // Load persisted results on mount
    useEffect(() => {
        store.loadPersistedResults();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync local input when store searchQuery changes externally (e.g. on load)
    useEffect(() => {
        setInputQuery(store.searchQuery);
    }, [store.searchQuery]);

    // Debounce search input → store
    useEffect(() => {
        const t = setTimeout(() => store.setSearchQuery(inputQuery), 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputQuery]);

    const filteredResults = useMemo(() => {
        const filtered = store.results.filter(r => {
            if (store.filter === 'high' && r.match?.confidence !== 'high') return false;
            if (store.filter === 'medium' && r.match?.confidence !== 'medium') return false;
            if (store.filter === 'low' && r.match?.confidence !== 'low') return false;
            if (store.filter === 'unmatched' && r.match !== null) return false;
            if (store.searchQuery) {
                const q = store.searchQuery.trim();
                if (q) {
                    const override = store.overrides.get(r.locationString);
                    const effectivePlace = override?.place ?? r.match?.place;
                    const effectiveSiteName = override?.siteName ?? r.match?.siteName;
                    const haystack = [
                        r.locationString,
                        effectivePlace?.name,
                        effectivePlace?.admin1Name,
                        effectivePlace?.admin2Name,
                        effectivePlace?.countryCode,
                        effectivePlace?.historicalName,
                        effectiveSiteName,
                    ].filter(Boolean).join(' | ').toLowerCase();
                    const segments = q.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                    if (!segments.every(seg => haystack.includes(seg))) return false;
                }
            }
            return true;
        });
        return sortResults(filtered, store.sortBy, store.sortOrder);
    }, [store.results, store.filter, store.searchQuery, store.sortBy, store.sortOrder, store.overrides]);

    const selectedCount = store.checked.size;

    const totalEvents = useMemo(() => {
        let count = 0;
        for (const r of store.results) {
            if (store.checked.has(r.locationString)) {
                count += r.occurrences.length;
            }
        }
        return count;
    }, [store.results, store.checked]);

    // Select-all: only rows that have a match or override
    const visibleMatchable = useMemo(() =>
        filteredResults.filter(r => r.match || store.overrides.has(r.locationString)).map(r => r.locationString),
        [filteredResults, store.overrides],
    );
    const visibleCheckedCount = useMemo(() =>
        visibleMatchable.filter(ls => store.checked.has(ls)).length,
        [visibleMatchable, store.checked],
    );
    const allVisibleChecked = visibleMatchable.length > 0 && visibleCheckedCount === visibleMatchable.length;

    const rowVirtualizer = useVirtualizer({
        count: filteredResults.length,
        getScrollElement: () => scrollEl,
        estimateSize: () => 80,
        overscan: 15,
    });

    const handleScan = useCallback(async () => {
        await store.startScan();
        store.setDialogOpen(true);
    }, [store]);

    const handleRescan = useCallback(async () => {
        await store.clearResults();
        await store.startScan();
        store.setDialogOpen(true);
    }, [store]);

    const handleApply = useCallback(async () => {
        setIsApplying(true);
        try {
            const result = await store.applySelected();
            toast.success(`Geocoded ${result.eventsUpdated} events across ${result.updated} people`);
            queryClient.invalidateQueries({ queryKey: ['people'] });
            queryClient.invalidateQueries({ queryKey: ['person'] });
            queryClient.invalidateQueries({ queryKey: ['search'] });
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to apply geocoding');
        } finally {
            setIsApplying(false);
        }
    }, [store, queryClient]);

    const handleFilterToggle = useCallback((f: ConfidenceFilter) => {
        store.setFilter(store.filter === f ? 'all' : f);
    }, [store]);

    const handleToggle = useCallback((locationString: string) => {
        store.toggleSelection(locationString);
    }, [store]);

    const handleSetOverride = useCallback((locationString: string, place: Place) => {
        store.setOverride(locationString, place, null);
        // Auto-check the row when user manually assigns a place
        if (!store.checked.has(locationString)) {
            store.toggleSelection(locationString);
        }
    }, [store]);

    const handleClearOverride = useCallback((locationString: string) => {
        store.clearOverride(locationString);
    }, [store]);

    const handleEditStart = useCallback((locationString: string) => {
        setEditingRow(locationString);
    }, []);

    const handleEditEnd = useCallback(() => {
        setEditingRow(null);
    }, []);

    const handleSelectAll = useCallback(() => {
        if (allVisibleChecked) {
            store.deselectAll(visibleMatchable);
        } else {
            store.selectAll(visibleMatchable);
        }
    }, [store, allVisibleChecked, visibleMatchable]);

    const handleExportCsv = useCallback(() => {
        const header = ['Location', 'Matched Place', 'Confidence', 'Site Name', 'Latitude', 'Longitude', 'Events', 'Selected'];
        const rows = filteredResults.map(r => {
            const override = store.overrides.get(r.locationString);
            const effectivePlace = override?.place ?? r.match?.place;
            const effectiveSiteName = override ? override.siteName : r.match?.siteName;
            const confidence = override ? 'edited' : (r.match?.confidence ?? 'none');
            return [
                escapeCsvField(r.locationString),
                escapeCsvField(effectivePlace ? formatPlaceDisplay(effectivePlace) : ''),
                confidence,
                escapeCsvField(effectiveSiteName ?? ''),
                effectivePlace?.lat?.toFixed(4) ?? '',
                effectivePlace?.lng?.toFixed(4) ?? '',
                String(r.occurrences.length),
                store.checked.has(r.locationString) ? 'yes' : 'no',
            ].join(',');
        });
        const csv = [header.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `geocode-results-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [filteredResults, store.overrides, store.checked]);

    return (
        <>
            <div className="space-y-3 border-t border-border/50 pt-4">
                <div>
                    <h3 className="text-sm font-semibold">Geocode Locations</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Resolve imported location strings to geographic places with coordinates.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {store.status === 'idle' && (
                        <Button variant="outline" onClick={handleScan}>
                            <MapPin className="h-4 w-4 mr-2" /> Scan Locations
                        </Button>
                    )}
                    {store.status === 'scanning' && (
                        <Button variant="outline" onClick={() => store.setDialogOpen(true)}>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Scanning...{store.progress && store.progress.total > 0 && store.progress.percent < 100
                                ? ` ${store.progress.percent}%`
                                : ''}
                        </Button>
                    )}
                    {store.status === 'completed' && (
                        <>
                            <Button onClick={() => store.setDialogOpen(true)}>
                                <MapPinned className="h-4 w-4 mr-2" />
                                Review Results ({store.stats?.total ?? 0} locations)
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleRescan}>
                                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-scan
                            </Button>
                        </>
                    )}
                    {store.status === 'error' && (
                        <>
                            <Button variant="outline" onClick={handleScan}>
                                <MapPin className="h-4 w-4 mr-2" /> Retry Scan
                            </Button>
                            <span className="text-xs text-destructive">{store.error}</span>
                        </>
                    )}
                </div>
            </div>

            <Dialog open={store.dialogOpen} onOpenChange={store.setDialogOpen}>
                <DialogContent
                    className="sm:max-w-3xl max-h-[85vh] flex flex-col"
                    onEscapeKeyDown={(e) => { if (editingRow) e.preventDefault(); }}
                >
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MapPinned className="h-5 w-5" /> Batch Geocoding Results
                        </DialogTitle>
                        {store.status === 'scanning' && (
                            <DialogDescription>
                                {store.progress && store.progress.total > 0
                                    ? `Scanning... ${store.progress.processed} / ${store.progress.total} locations (${store.progress.percent}%)`
                                    : 'Scanning locations...'}
                            </DialogDescription>
                        )}
                        {store.status === 'completed' && store.stats && (
                            <DialogDescription>
                                {store.stats.total} unresolved locations found
                                {store.stats.alreadyResolved > 0 && ` (${store.stats.alreadyResolved} already resolved)`}.
                                {' '}Each row shows the original location string and its best match. Select rows to apply.
                            </DialogDescription>
                        )}
                    </DialogHeader>

                    {store.status === 'scanning' && (
                        <div className="w-full">
                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                {store.progress && store.progress.total > 0 ? (
                                    <div
                                        className="h-full bg-primary transition-all duration-300 ease-out"
                                        style={{ width: `${store.progress.percent}%` }}
                                    />
                                ) : (
                                    <div className="h-full w-1/3 bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5 text-center">
                                {store.progress && store.progress.total > 0
                                    ? `Processing location ${store.progress.processed} of ${store.progress.total}`
                                    : 'Scanning for unresolved locations...'}
                            </p>
                        </div>
                    )}

                    {store.status === 'completed' && store.stats && (
                        <>
                            <div className="flex flex-wrap gap-2">
                                <StatBadge label="High" count={store.stats.high} color="emerald" active={store.filter === 'high'} onClick={() => handleFilterToggle('high')} />
                                <StatBadge label="Medium" count={store.stats.medium} color="amber" active={store.filter === 'medium'} onClick={() => handleFilterToggle('medium')} />
                                <StatBadge label="Low" count={store.stats.low} color="orange" active={store.filter === 'low'} onClick={() => handleFilterToggle('low')} />
                                <StatBadge label="No match" count={store.stats.unmatched} color="red" active={store.filter === 'unmatched'} onClick={() => handleFilterToggle('unmatched')} />
                                {store.filter !== 'all' && (
                                    <button className="text-xs text-muted-foreground hover:text-foreground ml-1" onClick={() => store.setFilter('all')}>
                                        Show all
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search locations or matched places..."
                                        value={inputQuery}
                                        onChange={(e) => setInputQuery(e.target.value)}
                                        className="pl-8 h-9"
                                    />
                                </div>
                            </div>

                            {/* Sort + select-all bar */}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <span className="mr-1">Sort:</span>
                                    {(['alpha', 'events'] as const).map(s => {
                                        const isActive = store.sortBy === s;
                                        const SortIcon = isActive
                                            ? (store.sortOrder === 'asc' ? ChevronUp : ChevronDown)
                                            : ArrowUpDown;
                                        return (
                                            <button
                                                key={s}
                                                onClick={() => store.setSortBy(s)}
                                                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                                            >
                                                {s === 'alpha' ? 'Name' : 'Events'}
                                                <SortIcon className={`h-3 w-3 ${isActive ? '' : 'opacity-40'}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                                {visibleMatchable.length > 0 && (
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleChecked}
                                            ref={el => { if (el) el.indeterminate = visibleCheckedCount > 0 && !allVisibleChecked; }}
                                            onChange={handleSelectAll}
                                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                                        />
                                        <span>
                                            {visibleCheckedCount === 0
                                                ? `Select all ${visibleMatchable.length}`
                                                : allVisibleChecked
                                                    ? `All ${visibleMatchable.length} selected`
                                                    : `${visibleCheckedCount} of ${visibleMatchable.length} selected`
                                            }
                                        </span>
                                    </label>
                                )}
                            </div>

                            <div ref={setScrollEl} className="flex-1 overflow-y-auto min-h-0 -mx-6 px-6">
                                {filteredResults.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">
                                        {store.results.length === 0 ? 'No unresolved locations found.' : 'No results match the current filter.'}
                                    </p>
                                ) : (
                                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                            const r = filteredResults[virtualRow.index];
                                            return (
                                                <div
                                                    key={r.locationString}
                                                    data-index={virtualRow.index}
                                                    ref={rowVirtualizer.measureElement}
                                                    style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: 0,
                                                        width: '100%',
                                                        transform: `translateY(${virtualRow.start}px)`,
                                                        zIndex: editingRow === r.locationString ? 10 : undefined,
                                                    }}
                                                >
                                                    <GeocodeResultRow
                                                        result={r}
                                                        checked={store.checked.has(r.locationString)}
                                                        override={store.overrides.get(r.locationString) ?? null}
                                                        onToggle={handleToggle}
                                                        onSetOverride={handleSetOverride}
                                                        onClearOverride={handleClearOverride}
                                                        onEditStart={handleEditStart}
                                                        onEditEnd={handleEditEnd}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                                    <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                                </Button>
                                <div className="flex-1" />
                                <Button variant="outline" onClick={() => store.setDialogOpen(false)}>Cancel</Button>
                                <Button
                                    disabled={selectedCount === 0 || isApplying}
                                    onClick={handleApply}
                                >
                                    {isApplying ? (
                                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying...</>
                                    ) : (
                                        <>Apply {selectedCount} Selected ({totalEvents} events)</>
                                    )}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

const CONFIDENCE_COLORS = {
    high: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    low: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
} as const;

interface GeocodeResultRowProps {
    result: BatchGeocodeResult;
    checked: boolean;
    override: { place: Place; siteName: string | null } | null;
    onToggle: (locationString: string) => void;
    onSetOverride: (locationString: string, place: Place) => void;
    onClearOverride: (locationString: string) => void;
    onEditStart: (locationString: string) => void;
    onEditEnd: () => void;
}

const GeocodeResultRow = memo(function GeocodeResultRow({
    result, checked, override, onToggle, onSetOverride, onClearOverride, onEditStart, onEditEnd,
}: GeocodeResultRowProps) {
    const { match } = result;
    const eventCount = result.occurrences.length;
    const [editing, setEditing] = useState(false);
    const [editQuery, setEditQuery] = useState('');

    const effectivePlace = override?.place ?? match?.place;
    const effectiveSiteName = override ? override.siteName : match?.siteName;
    const hasCheckbox = !!(match || override);

    const handleEdit = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (editing) {
            setEditing(false);
            onEditEnd();
        } else {
            setEditQuery(effectivePlace ? formatPlaceDisplay(effectivePlace) : result.locationString);
            setEditing(true);
            onEditStart(result.locationString);
        }
    };

    const handleCloseEdit = useCallback(() => {
        setEditing(false);
        onEditEnd();
    }, [onEditEnd]);

    const handlePlaceSelect = (place: Place) => {
        onSetOverride(result.locationString, place);
        setEditing(false);
        onEditEnd();
    };

    const handleReset = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onClearOverride(result.locationString);
        setEditing(false);
        onEditEnd();
    };

    return (
        <div className="py-1">
            <label className={`flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer transition-colors ${override ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                {hasCheckbox ? (
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(result.locationString)}
                        className="mt-1 shrink-0 h-4 w-4 rounded border-border accent-primary"
                    />
                ) : (
                    <div className="mt-1 shrink-0 h-4 w-4" />
                )}

                <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Original</span>
                        <span className="text-sm font-medium truncate" title={result.locationString}>
                            {result.locationString}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {eventCount} {eventCount === 1 ? 'event' : 'events'}
                        </Badge>
                    </div>

                    {effectivePlace ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                            <ArrowRight className="h-3 w-3 shrink-0 text-primary/60" />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Matched to</span>
                            <span className="font-medium text-foreground">
                                {formatPlaceDisplay(effectivePlace)}
                            </span>
                            {effectivePlace.lat != null && effectivePlace.lng != null && (
                                <span className="text-muted-foreground">
                                    ({formatCoordinates(effectivePlace)})
                                </span>
                            )}
                            {!override && match && (
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${CONFIDENCE_COLORS[match.confidence]}`}>
                                    {match.confidence}
                                </Badge>
                            )}
                            {override && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border border-primary/30 bg-primary/10 text-primary">
                                    edited
                                </Badge>
                            )}
                            {effectiveSiteName && (
                                <TooltipProvider delayDuration={300}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                                                <Landmark className="h-2.5 w-2.5" />
                                                {effectiveSiteName}
                                            </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-xs text-xs">
                                            Specific location extracted from the original string (e.g. a cemetery, church, or hospital). Will be saved as the event&apos;s site name.
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                            <button
                                onClick={handleEdit}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                title={editing ? 'Close editor' : 'Edit matched place'}
                            >
                                {editing ? <X className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                            </button>
                            {override && (
                                <button
                                    onClick={handleReset}
                                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                    title="Reset to original match"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>No match found</span>
                            <button
                                onClick={handleEdit}
                                className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors font-medium"
                            >
                                {editing ? <><X className="h-3 w-3" /> Close</> : <><Pencil className="h-3 w-3" /> Assign manually</>}
                            </button>
                        </div>
                    )}

                    {editing && (
                        <div className="pt-1" onClick={(e) => e.preventDefault()}>
                            <PlaceSearchCombobox
                                value={editQuery}
                                onChange={setEditQuery}
                                onSelect={handlePlaceSelect}
                                onDismiss={handleCloseEdit}
                                initialPlace={effectivePlace}
                                size="sm"
                                autoFocus
                                placeholder="Search for a place..."
                                inputClassName="h-7 text-xs"
                            />
                        </div>
                    )}
                </div>
            </label>
        </div>
    );
});

function StatBadge({ label, count, color, active, onClick }: {
    label: string;
    count: number;
    color: 'emerald' | 'amber' | 'orange' | 'red';
    active: boolean;
    onClick: () => void;
}) {
    const colorClasses = {
        emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        amber: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        orange: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
        red: 'bg-red-500/10 text-red-600 border-red-500/30',
    };
    return (
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${colorClasses[color]} ${active ? 'ring-2 ring-offset-1 ring-offset-background ring-current' : ''}`}
        >
            {label} <span className="font-bold">{count}</span>
        </button>
    );
}
