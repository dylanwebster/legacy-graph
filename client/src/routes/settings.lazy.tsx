import { createLazyFileRoute } from '@tanstack/react-router';
import { useSystemStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { useState, useCallback } from 'react';
import { RefreshCw, Camera, Loader2, Server, Database, Clock, Activity } from 'lucide-react';

export const Route = createLazyFileRoute('/settings')({
    component: SettingsPage,
});

function SettingsPage() {
    const { data: status, isLoading } = useSystemStatus();
    const [rebuilding, setRebuilding] = useState(false);
    const [snapshotName, setSnapshotName] = useState('');
    const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
    const [snapshotting, setSnapshotting] = useState(false);

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
                        <StatusCard icon={Database} label="Nodes" value={String(status?.stats?.nodeCount ?? '—')} />
                        <StatusCard icon={Database} label="Edges" value={String(status?.stats?.edgeCount ?? '—')} />
                        <StatusCard icon={Clock} label="Last Modified" value={status?.stats?.last_modified ? new Date(status.stats.last_modified).toLocaleString() : '—'} />
                    </div>
                )}
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
        </div>
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
                    ) : value === 'hydrating' ? (
                        <Badge variant="default" className="bg-amber-500/10 text-amber-500 border-amber-500/20">{value}</Badge>
                    ) : (
                        value
                    )}
                </div>
            </div>
        </div>
    );
}
