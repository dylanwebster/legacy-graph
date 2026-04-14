import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useSystemStatus } from '@/api/hooks';
import type { BatchGeocodeResult } from '@/api/client';
import type { Place } from '@/api/people';
import { useGeocodeStore, type SortBy } from '@/store/geocodeStore';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import {
    RefreshCw, Camera, Loader2, Server, Database, Clock, Activity,
    Sun, Moon, Palette, Upload, Download, AlertTriangle, CheckCircle2,
    MapPin, Search, ArrowRight, MapPinned, Pencil, RotateCcw, Landmark,
    ArrowUpDown,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { toast } from 'sonner';

export const Route = createLazyFileRoute('/settings')({
    component: SettingsPage,
});

const IMPORT_MODE_DESCRIPTIONS = {
    replace: 'All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed.',
    additive: 'People from this file will be added to your existing data. Duplicates are detected by matching first name, last name, and birth year — matched records will be skipped to preserve any hand-crafted edits. Name or date discrepancies may still result in duplicates.',
} as const;

function SettingsPage() {
    const { data: status, isLoading } = useSystemStatus();
    const { theme, toggleTheme } = useUIStore();
    const navigate = useNavigate();

    // Cache / snapshot state
    const [rebuilding, setRebuilding] = useState(false);
    const [snapshotName, setSnapshotName] = useState('');
    const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
    const [snapshotting, setSnapshotting] = useState(false);

    // Import state
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [importConfirmOpen, setImportConfirmOpen] = useState(false);
    const [importProgress, setImportProgress] = useState<{ phase?: string; percent?: number } | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [importMode, setImportMode] = useState<'replace' | 'additive'>('replace');
    const [importResult, setImportResult] = useState<{ imported: number; skipped?: number } | null>(null);
    const evtSourceRef = useRef<EventSource | null>(null);

    const handleRebuild = useCallback(async () => {
        setRebuilding(true);
        try {
            await fetch('/api/system/rebuild', { method: 'POST' });
        } catch { /* ignore */ }
        setTimeout(() => setRebuilding(false), 3000);
    }, []);

    const handleSnapshot = useCallback(async () => {
        if (!snapshotName.trim()) return;
        setSnapshotting(true);
        try {
            await fetch('/api/system/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: snapshotName }),
            });
        } catch { /* ignore */ }
        setSnapshotting(false);
        setSnapshotDialogOpen(false);
        setSnapshotName('');
    }, [snapshotName]);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f && f.name.endsWith('.ged')) {
            setImportFile(f);
            setImportError(null);
            setImportResult(null);
        } else {
            setImportError('Please select a valid .ged file');
        }
    }, []);

    const handleImport = useCallback(async () => {
        if (!importFile) return;
        setImportConfirmOpen(false);
        setImporting(true);
        setImportError(null);
        setImportResult(null);

        try {
            const formData = new FormData();
            formData.append('file', importFile);
            formData.append('mode', importMode);

            const response = await fetch('/api/import/gedcom', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error((err as { error?: string }).error || 'Upload failed');
            }

            const result = await response.json() as { imported: number; skipped?: number };

            const evtSource = new EventSource('/api/system/hydration/stream');
            evtSourceRef.current = evtSource;

            evtSource.addEventListener('progress', (e) => {
                try {
                    const data = JSON.parse((e as MessageEvent).data) as { phase?: string; percent?: number };
                    setImportProgress({ phase: data.phase, percent: data.percent });
                } catch { /* ignore */ }
            });

            evtSource.addEventListener('complete', () => {
                evtSource.close();
                evtSourceRef.current = null;
                setImporting(false);
                if (importMode === 'additive') {
                    setImportResult({ imported: result.imported, skipped: result.skipped });
                } else {
                    navigate({ to: '/' });
                }
            });

            evtSource.addEventListener('error', () => {
                evtSource.close();
                evtSourceRef.current = null;
                setImporting(false);
                setImportError('Import completed but hydration stream disconnected.');
            });
        } catch (err) {
            setImporting(false);
            setImportError(err instanceof Error ? err.message : 'Upload failed');
        }
    }, [importFile, importMode, navigate]);

    useEffect(() => {
        return () => { evtSourceRef.current?.close(); };
    }, []);

    return (
        <div className="h-full overflow-auto p-6 max-w-2xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">System status and configuration</p>
            </div>

            {/* System Status */}
            <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Activity className="h-5 w-5" /> System Status
                </h2>
                {isLoading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <StatusCard icon={Server} label="Hydration State" value={status?.hydrationState ?? 'unknown'} />
                        <StatusCard icon={Database} label="Nodes" value={String(status?.nodeCount ?? '—')} />
                        <StatusCard icon={Database} label="Edges" value={String(status?.edgeCount ?? '—')} />
                        <StatusCard icon={Clock} label="Cache Written" value={status?.cacheAge ? new Date(status.cacheAge).toLocaleString() : '—'} />
                    </div>
                )}
            </div>

            {/* Appearance */}
            <div className="space-y-4 border-t border-border pt-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Palette className="h-5 w-5" /> Appearance
                </h2>
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                    <div>
                        <div className="text-sm font-medium">Theme</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</div>
                    </div>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={toggleTheme}
                        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                    >
                        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {/* Cache Management */}
            <div className="space-y-4 border-t border-border pt-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <RefreshCw className="h-5 w-5" /> Cache Management
                </h2>
                <div className="flex gap-3">
                    <Button variant="outline" disabled={rebuilding} onClick={handleRebuild}>
                        {rebuilding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rebuilding...</> : <><RefreshCw className="h-4 w-4 mr-2" /> Force Rebuild</>}
                    </Button>
                    <Button variant="outline" onClick={() => setSnapshotDialogOpen(true)}>
                        <Camera className="h-4 w-4 mr-2" /> Create Snapshot
                    </Button>
                </div>
            </div>

            {/* Data */}
            <div className="space-y-6 border-t border-border pt-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Database className="h-5 w-5" /> Data
                </h2>

                {/* Import GEDCOM */}
                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-semibold">Import GEDCOM</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Upload a GEDCOM (.ged) file to populate the graph.</p>
                    </div>

                    <label
                        htmlFor="gedcom-upload"
                        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-muted/30 hover:border-muted-foreground/30 transition-colors"
                    >
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <div className="text-center">
                            <p className="text-sm font-medium">{importFile ? importFile.name : 'Click to select a .ged file'}</p>
                            {importFile && (
                                <p className="text-xs text-muted-foreground mt-1">{(importFile.size / 1024).toFixed(1)} KB</p>
                            )}
                        </div>
                        <Input
                            id="gedcom-upload"
                            type="file"
                            accept=".ged"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                    </label>

                    <div className="space-y-3">
                        <p id="import-mode-label" className="text-sm font-medium">Import mode</p>
                        <RadioGroup
                            value={importMode}
                            onValueChange={(v) => { if (v === 'replace' || v === 'additive') setImportMode(v); }}
                            aria-labelledby="import-mode-label"
                            className="space-y-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="replace" id="mode-replace" />
                                <Label htmlFor="mode-replace" className="cursor-pointer">Replace existing people</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="additive" id="mode-additive" />
                                <Label htmlFor="mode-additive" className="cursor-pointer">Add to existing people</Label>
                            </div>
                        </RadioGroup>
                        <p className="text-xs text-muted-foreground">{IMPORT_MODE_DESCRIPTIONS[importMode]}</p>
                    </div>

                    {importError && (
                        <Badge variant="destructive" className="w-full justify-center py-2">{importError}</Badge>
                    )}

                    {importResult && (
                        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
                            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                            <div className="space-y-1">
                                <p className="text-sm font-medium">Import complete</p>
                                <p className="text-xs text-muted-foreground">
                                    {importResult.imported} {importResult.imported === 1 ? 'person' : 'people'} added
                                    {importResult.skipped != null && importResult.skipped > 0
                                        ? `, ${importResult.skipped} duplicate${importResult.skipped === 1 ? '' : 's'} skipped`
                                        : ''}
                                </p>
                            </div>
                            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => navigate({ to: '/' })}>
                                Go to graph
                            </Button>
                        </div>
                    )}

                    {importing && importProgress && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>{importProgress.phase || 'Processing...'}</span>
                                {importProgress.percent !== undefined && <span>{Math.round(importProgress.percent)}%</span>}
                            </div>
                            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${importProgress.percent || 0}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <Button
                        disabled={!importFile || importing || !!importResult}
                        onClick={() => setImportConfirmOpen(true)}
                    >
                        {importing ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</>
                        ) : (
                            <><Upload className="h-4 w-4 mr-2" /> Import File</>
                        )}
                    </Button>
                </div>

                {/* Geocode Locations */}
                <GeocodeLocationsSection />

                {/* Export GEDCOM */}
                <div className="space-y-3 border-t border-border/50 pt-4">
                    <div>
                        <h3 className="text-sm font-semibold">Export GEDCOM</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Download your entire family tree as a standard GEDCOM 5.5.1 file.</p>
                    </div>
                    <Button variant="outline" disabled title="Export GEDCOM is not yet implemented">
                        <Download className="h-4 w-4 mr-2" /> Download GEDCOM
                    </Button>
                    <p className="text-xs text-muted-foreground italic">Export is not yet implemented.</p>
                </div>
            </div>

            {/* Snapshot dialog */}
            <Dialog open={snapshotDialogOpen} onOpenChange={setSnapshotDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Snapshot</DialogTitle>
                        <DialogDescription>Give this snapshot a descriptive name.</DialogDescription>
                    </DialogHeader>
                    <Input
                        placeholder="Snapshot name..."
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                    />
                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="outline" onClick={() => setSnapshotDialogOpen(false)}>Cancel</Button>
                        <Button disabled={!snapshotName.trim() || snapshotting} onClick={handleSnapshot}>
                            {snapshotting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Create
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Import confirmation dialog */}
            <Dialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {importMode === 'replace' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
                            {importMode === 'replace' ? 'Destructive Action' : 'Add to Existing Data'}
                        </DialogTitle>
                        <DialogDescription>{IMPORT_MODE_DESCRIPTIONS[importMode]}</DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="outline" onClick={() => setImportConfirmOpen(false)}>Cancel</Button>
                        <Button
                            variant={importMode === 'replace' ? 'destructive' : 'default'}
                            onClick={handleImport}
                        >
                            {importMode === 'replace' ? 'Yes, Replace All' : 'Yes, Import'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low' | 'unmatched';

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function sortResults(results: BatchGeocodeResult[], sortBy: SortBy): BatchGeocodeResult[] {
    const sorted = [...results];
    switch (sortBy) {
        case 'alpha':
            sorted.sort((a, b) => a.locationString.localeCompare(b.locationString));
            break;
        case 'confidence':
            sorted.sort((a, b) => (CONFIDENCE_RANK[b.match?.confidence ?? ''] ?? 0) - (CONFIDENCE_RANK[a.match?.confidence ?? ''] ?? 0));
            break;
        case 'events':
            sorted.sort((a, b) => b.occurrences.length - a.occurrences.length);
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

function GeocodeLocationsSection() {
    const store = useGeocodeStore();
    const queryClient = useQueryClient();
    const [isApplying, setIsApplying] = useState(false);
    const [inputQuery, setInputQuery] = useState(store.searchQuery);
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
                const q = store.searchQuery.toLowerCase();
                const override = store.overrides.get(r.locationString);
                if (!r.locationString.toLowerCase().includes(q) &&
                    !(r.match?.place.name ?? '').toLowerCase().includes(q) &&
                    !(override?.place.name ?? '').toLowerCase().includes(q)) {
                    return false;
                }
            }
            return true;
        });
        return sortResults(filtered, store.sortBy);
    }, [store.results, store.filter, store.searchQuery, store.sortBy, store.overrides]);

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
                <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
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
                                    <ArrowUpDown className="h-3 w-3" />
                                    <span className="mr-1">Sort:</span>
                                    {(['alpha', 'confidence', 'events'] as const).map(s => (
                                        <button
                                            key={s}
                                            onClick={() => store.setSortBy(s)}
                                            className={`px-2 py-0.5 rounded-md transition-colors ${store.sortBy === s ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
                                        >
                                            {s === 'alpha' ? 'A\u2013Z' : s === 'confidence' ? 'Confidence' : 'Events'}
                                        </button>
                                    ))}
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
                                                    }}
                                                >
                                                    <GeocodeResultRow
                                                        result={r}
                                                        checked={store.checked.has(r.locationString)}
                                                        override={store.overrides.get(r.locationString) ?? null}
                                                        onToggle={handleToggle}
                                                        onSetOverride={handleSetOverride}
                                                        onClearOverride={handleClearOverride}
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
}

const GeocodeResultRow = memo(function GeocodeResultRow({
    result, checked, override, onToggle, onSetOverride, onClearOverride,
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
        setEditQuery(effectivePlace ? formatPlaceDisplay(effectivePlace) : result.locationString);
        setEditing(true);
    };

    const handlePlaceSelect = (place: Place) => {
        onSetOverride(result.locationString, place);
        setEditing(false);
    };

    const handleReset = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onClearOverride(result.locationString);
        setEditing(false);
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
                                title="Edit matched place"
                            >
                                <Pencil className="h-3 w-3" />
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
                                <Pencil className="h-3 w-3" /> Assign manually
                            </button>
                        </div>
                    )}

                    {editing && (
                        <div className="pt-1" onClick={(e) => e.preventDefault()}>
                            <PlaceSearchCombobox
                                value={editQuery}
                                onChange={setEditQuery}
                                onSelect={handlePlaceSelect}
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

function StatusCard({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
    return (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
                <div className="text-xs text-muted-foreground font-medium">{label}</div>
                <div className="text-sm font-medium truncate">
                    {value === 'ready' ? (
                        <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{value}</Badge>
                    ) : value === 'loading' ? (
                        <Badge variant="default" className="bg-amber-500/10 text-amber-500 border-amber-500/20">{value}</Badge>
                    ) : (
                        value
                    )}
                </div>
            </div>
        </div>
    );
}
