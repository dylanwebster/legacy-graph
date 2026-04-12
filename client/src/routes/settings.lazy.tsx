import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useSystemStatus, useBatchGeocode, useApplyBatchGeocode } from '@/api/hooks';
import type { BatchGeocodeResult, BatchGeocodeUpdate } from '@/api/client';
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
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    RefreshCw, Camera, Loader2, Server, Database, Clock, Activity,
    Sun, Moon, Palette, Upload, Download, AlertTriangle, CheckCircle2,
    MapPin, Search, ArrowRight, MapPinned,
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

function GeocodeLocationsSection() {
    const batchGeocode = useBatchGeocode();
    const applyBatch = useApplyBatchGeocode();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [filter, setFilter] = useState<ConfidenceFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const results = useMemo(() => batchGeocode.data?.results ?? [], [batchGeocode.data]);
    const stats = batchGeocode.data?.stats;

    const handleScan = useCallback(async () => {
        const data = await batchGeocode.mutateAsync(undefined);
        // Pre-check high and medium confidence matches
        const preChecked = new Set<string>();
        for (const r of data.results) {
            if (r.match && (r.match.confidence === 'high' || r.match.confidence === 'medium')) {
                preChecked.add(r.locationString);
            }
        }
        setSelected(preChecked);
        setFilter('all');
        setSearchQuery('');
        setDialogOpen(true);
    }, [batchGeocode]);

    const filteredResults = useMemo(() => {
        return results.filter(r => {
            // Filter by confidence
            if (filter === 'high' && r.match?.confidence !== 'high') return false;
            if (filter === 'medium' && r.match?.confidence !== 'medium') return false;
            if (filter === 'low' && r.match?.confidence !== 'low') return false;
            if (filter === 'unmatched' && r.match !== null) return false;
            // Filter by search query
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (!r.locationString.toLowerCase().includes(q) &&
                    !(r.match?.place.name ?? '').toLowerCase().includes(q)) {
                    return false;
                }
            }
            return true;
        });
    }, [results, filter, searchQuery]);

    const selectedCount = selected.size;

    const handleToggle = useCallback((locStr: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(locStr)) next.delete(locStr);
            else next.add(locStr);
            return next;
        });
    }, []);

    const handleApply = useCallback(async () => {
        const updates: BatchGeocodeUpdate[] = [];
        for (const r of results) {
            if (selected.has(r.locationString) && r.match) {
                updates.push({
                    locationString: r.locationString,
                    place: r.match.place,
                    siteName: r.match.siteName,
                });
            }
        }
        if (updates.length === 0) return;

        try {
            const result = await applyBatch.mutateAsync(updates);
            toast.success(`Geocoded ${result.eventsUpdated} events across ${result.updated} people`);
            setDialogOpen(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to apply geocoding');
        }
    }, [results, selected, applyBatch]);

    const totalEvents = useMemo(() => {
        let count = 0;
        for (const r of results) {
            if (selected.has(r.locationString)) {
                count += r.occurrences.length;
            }
        }
        return count;
    }, [results, selected]);

    return (
        <>
            <div className="space-y-3 border-t border-border/50 pt-4">
                <div>
                    <h3 className="text-sm font-semibold">Geocode Locations</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Resolve imported location strings to geographic places with coordinates.
                    </p>
                </div>
                <Button
                    variant="outline"
                    disabled={batchGeocode.isPending}
                    onClick={handleScan}
                >
                    {batchGeocode.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scanning...</>
                    ) : (
                        <><MapPin className="h-4 w-4 mr-2" /> Scan Locations</>
                    )}
                </Button>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MapPinned className="h-5 w-5" /> Batch Geocoding Results
                        </DialogTitle>
                        {stats && (
                            <DialogDescription>
                                {stats.total} unresolved locations found
                                {stats.alreadyResolved > 0 && ` (${stats.alreadyResolved} already resolved)`}
                            </DialogDescription>
                        )}
                    </DialogHeader>

                    {stats && (
                        <div className="flex flex-wrap gap-2">
                            <StatBadge label="High" count={stats.high} color="emerald" active={filter === 'high'} onClick={() => setFilter(f => f === 'high' ? 'all' : 'high')} />
                            <StatBadge label="Medium" count={stats.medium} color="amber" active={filter === 'medium'} onClick={() => setFilter(f => f === 'medium' ? 'all' : 'medium')} />
                            <StatBadge label="Low" count={stats.low} color="orange" active={filter === 'low'} onClick={() => setFilter(f => f === 'low' ? 'all' : 'low')} />
                            <StatBadge label="No match" count={stats.unmatched} color="red" active={filter === 'unmatched'} onClick={() => setFilter(f => f === 'unmatched' ? 'all' : 'unmatched')} />
                            {filter !== 'all' && (
                                <button className="text-xs text-muted-foreground hover:text-foreground ml-1" onClick={() => setFilter('all')}>
                                    Show all
                                </button>
                            )}
                        </div>
                    )}

                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter locations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 h-9"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 space-y-1 -mx-6 px-6">
                        {filteredResults.length === 0 && (
                            <p className="text-sm text-muted-foreground text-center py-8">
                                {results.length === 0 ? 'No unresolved locations found.' : 'No results match the current filter.'}
                            </p>
                        )}
                        {filteredResults.map((r) => (
                            <GeocodeResultRow
                                key={r.locationString}
                                result={r}
                                checked={selected.has(r.locationString)}
                                onToggle={() => handleToggle(r.locationString)}
                            />
                        ))}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button
                            disabled={selectedCount === 0 || applyBatch.isPending}
                            onClick={handleApply}
                        >
                            {applyBatch.isPending ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Applying...</>
                            ) : (
                                <>Apply {selectedCount} Selected ({totalEvents} events)</>
                            )}
                        </Button>
                    </DialogFooter>
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

function GeocodeResultRow({ result, checked, onToggle }: {
    result: BatchGeocodeResult;
    checked: boolean;
    onToggle: () => void;
}) {
    const { match } = result;
    const eventCount = result.occurrences.length;

    return (
        <label className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors">
            {match ? (
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={onToggle}
                    className="mt-1 shrink-0 h-4 w-4 rounded border-border accent-primary"
                />
            ) : (
                <div className="mt-1 shrink-0 h-4 w-4" />
            )}

            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" title={result.locationString}>
                        {result.locationString}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {eventCount} {eventCount === 1 ? 'event' : 'events'}
                    </Badge>
                </div>

                {match ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="font-medium text-foreground">
                            {[match.place.name, match.place.admin2Name, match.place.admin1Name, match.place.countryCode].filter(Boolean).join(', ')}
                        </span>
                        {match.place.lat != null && match.place.lng != null && (
                            <span className="text-muted-foreground">
                                ({match.place.lat.toFixed(2)}, {match.place.lng.toFixed(2)})
                            </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${CONFIDENCE_COLORS[match.confidence]}`}>
                            {match.confidence}
                        </Badge>
                        {match.siteName && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                site: {match.siteName}
                            </Badge>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-muted-foreground">
                        No match found
                    </div>
                )}
            </div>
        </label>
    );
}

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
