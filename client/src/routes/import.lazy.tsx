import { createLazyFileRoute } from '@tanstack/react-router';
import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Upload, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

export const Route = createLazyFileRoute('/import')({
    component: ImportPage,
});

function ImportPage() {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [progress, setProgress] = useState<{ phase?: string; percent?: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [mode, setMode] = useState<'replace' | 'additive'>('replace');
    const [importResult, setImportResult] = useState<{ imported: number; skipped?: number } | null>(null);
    const navigate = useNavigate();

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f && f.name.endsWith('.ged')) {
            setFile(f);
            setError(null);
        } else {
            setError('Please select a valid .ged file');
        }
    }, []);

    const handleUpload = useCallback(async () => {
        if (!file) return;
        setConfirmOpen(false);
        setUploading(true);
        setError(null);
        setImportResult(null);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('mode', mode);

            const response = await fetch('/api/import/gedcom', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error(err.error || 'Upload failed');
            }

            const result = await response.json();

            // Listen to hydration stream for progress
            const evtSource = new EventSource('/api/system/hydration/stream');

            evtSource.addEventListener('progress', (e) => {
                try {
                    const data = JSON.parse(e.data);
                    setProgress({ phase: data.phase, percent: data.percent });
                } catch { /* ignore */ }
            });

            evtSource.addEventListener('complete', () => {
                evtSource.close();
                setUploading(false);
                if (mode === 'additive') {
                    setImportResult({ imported: result.imported, skipped: result.skipped });
                } else {
                    navigate({ to: '/' });
                }
            });

            evtSource.addEventListener('error', () => {
                evtSource.close();
                setUploading(false);
                setError('Import completed but hydration stream disconnected.');
            });
        } catch (err) {
            setUploading(false);
            setError(err instanceof Error ? err.message : 'Upload failed');
        }
    }, [file, mode, navigate]);

    return (
        <div className="flex flex-col items-center justify-center h-full p-6">
            <div className="w-full max-w-lg space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Import GEDCOM</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Upload a GEDCOM (.ged) file to populate the graph.
                    </p>
                </div>

                {/* Drop zone */}
                <label
                    htmlFor="gedcom-upload"
                    className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-muted/30 hover:border-muted-foreground/30 transition-colors"
                >
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <div className="text-center">
                        <p className="text-sm font-medium">{file ? file.name : 'Click to select or drag a .ged file'}</p>
                        {file && (
                            <p className="text-xs text-muted-foreground mt-1">
                                {(file.size / 1024).toFixed(1)} KB
                            </p>
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

                {/* Mode selector */}
                <div className="space-y-3">
                    <p className="text-sm font-medium">Import mode</p>
                    <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'replace' | 'additive')} className="space-y-2">
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="replace" id="mode-replace" />
                            <Label htmlFor="mode-replace" className="cursor-pointer">Replace existing people</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="additive" id="mode-additive" />
                            <Label htmlFor="mode-additive" className="cursor-pointer">Add to existing people</Label>
                        </div>
                    </RadioGroup>
                    <p className="text-xs text-muted-foreground">
                        {mode === 'replace'
                            ? 'All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed.'
                            : 'People from this file will be added to your existing data. Duplicates are detected by matching first name, last name, and birth year — matched records will be skipped to preserve any hand-crafted edits. Name or date discrepancies may still result in duplicates.'}
                    </p>
                </div>

                {error && (
                    <Badge variant="destructive" className="w-full justify-center py-2">
                        {error}
                    </Badge>
                )}

                {/* Additive import result banner */}
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
                            Go to dashboard
                        </Button>
                    </div>
                )}

                {/* Upload progress */}
                {uploading && progress && (
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>{progress.phase || 'Processing...'}</span>
                            {progress.percent !== undefined && <span>{Math.round(progress.percent)}%</span>}
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${progress.percent || 0}%` }}
                            />
                        </div>
                    </div>
                )}

                <Button
                    className="w-full"
                    size="lg"
                    disabled={!file || uploading || !!importResult}
                    onClick={() => setConfirmOpen(true)}
                >
                    {uploading ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...
                        </>
                    ) : (
                        'Import File'
                    )}
                </Button>

                {/* Confirmation Dialog */}
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {mode === 'replace' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
                                {mode === 'replace' ? 'Destructive Action' : 'Add to Existing Data'}
                            </DialogTitle>
                            <DialogDescription>
                                {mode === 'replace'
                                    ? 'All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed. Are you sure?'
                                    : 'People from this file will be added to your existing data. Duplicates matched by name and birth year will be skipped. Name or date discrepancies may still result in duplicates. Continue?'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                            <Button
                                variant={mode === 'replace' ? 'destructive' : 'default'}
                                onClick={handleUpload}
                            >
                                {mode === 'replace' ? 'Yes, Replace All' : 'Yes, Import'}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
