import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { PersonChip } from '@/components/PersonChip';
import { ExternalLink } from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAssets, useDeleteGalleryAsset } from '@/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetListItem } from '@/api/client';
import type { AssetsQueryParams } from '@/api/client';
import { assetType } from '@/lib/assetUtils';
import { AssetLightbox } from '@/components/AssetLightbox';
import { AssetSearchBar } from '@/components/AssetSearchBar';
import type { PersonChipData } from '@/components/AssetSearchBar';
import { TopBarActions } from '@/components/TopBarSlotContext';
import { BulkUploadDialog } from '@/components/BulkUploadDialog';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    FileText, Trash2, ZoomIn, Upload,
    ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';

export const Route = createLazyFileRoute('/assets')({
    component: AssetGallery,
});

const COLS = 3;

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Display name: custom name → filename without extension */
function fileDisplayName(filename: string, name?: string): string {
    if (name) return name;
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    return base.replace(/[_-]/g, ' ');
}

// ── AssetCard ─────────────────────────────────────────────────────────────

interface AssetCardProps {
    asset: AssetListItem;
    onOpen: (filename: string) => void;
    onDeleteRequest: (filename: string) => void;
}

function AssetCard({ asset, onOpen, onDeleteRequest }: AssetCardProps) {
    const type = assetType(asset.filename);
    const isImg = type === 'image';
    const ext = asset.filename.split('.').pop()?.toUpperCase() ?? 'FILE';
    const displayName = fileDisplayName(asset.filename, asset.metadata.name);

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            {/* Thumbnail — 4:3 aspect ratio, object-contain on neutral bg */}
            <div className="group relative bg-muted/50 overflow-hidden" style={{ aspectRatio: '4/3' }}>
                {isImg ? (
                    <img
                        src={`/assets/${asset.filename}`}
                        alt={displayName}
                        className="object-contain w-full h-full"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full gap-2">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                        <Badge variant="secondary" className="text-[10px]">{ext}</Badge>
                    </div>
                )}

                {asset.isOrphan && (
                    <div className="absolute top-1.5 left-1.5">
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Unlinked</Badge>
                    </div>
                )}

                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                        type="button"
                        title="View details"
                        onClick={() => onOpen(asset.filename)}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white"
                    >
                        <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        title="Delete asset"
                        onClick={() => onDeleteRequest(asset.filename)}
                        className="p-1.5 rounded-full bg-white/20 hover:bg-red-500/70 text-white"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Info panel */}
            <div className="px-2 py-2 flex flex-col gap-1">
                {/* Primary title */}
                <p className="text-[10px] text-foreground font-medium truncate" title={displayName}>
                    {displayName}
                </p>
                {/* Filename (secondary, only if different from display name) */}
                {asset.metadata.name && (
                    <p className="text-[9px] text-muted-foreground truncate font-mono" title={asset.filename}>
                        {asset.filename}
                    </p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{ext}</Badge>
                    <span className="text-[9px] text-muted-foreground">{formatSize(asset.size)}</span>
                    {asset.metadata.date && (
                        <span className="text-[9px] text-muted-foreground">{asset.metadata.date}</span>
                    )}
                    {asset.metadata.location?.name && (
                        <span className="text-[9px] text-muted-foreground truncate" title={asset.metadata.location.name}>
                            {asset.metadata.location.name}
                        </span>
                    )}
                </div>
                {asset.referencedBy.people.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {asset.referencedBy.people.slice(0, 3).map((pid) => (
                            <PersonChip key={pid} id={pid} className="text-[8px]" />
                        ))}
                        {asset.referencedBy.people.length > 3 && (
                            <span className="text-[8px] text-muted-foreground">+{asset.referencedBy.people.length - 3}</span>
                        )}
                    </div>
                )}
                {asset.referencedBy.stories.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                        {asset.referencedBy.stories.slice(0, 2).map((s) => (
                            <Link
                                key={s.id}
                                to="/stories/$id"
                                params={{ id: s.id }}
                                className="text-[9px] text-primary flex items-center gap-0.5 hover:underline truncate"
                            >
                                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{s.title}</span>
                            </Link>
                        ))}
                        {asset.referencedBy.stories.length > 2 && (
                            <span className="text-[9px] text-muted-foreground">+{asset.referencedBy.stories.length - 2} more</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── AssetGallery page ──────────────────────────────────────────────────────

type SortKey = 'name' | 'size' | 'date' | 'created' | 'modified';
type TypeFilter = 'all' | 'image' | 'document';

function AssetGallery() {
    const queryClient = useQueryClient();
    const [query, setQuery] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [chips, setChips] = useState<PersonChipData[]>([]);
    const [orphansOnly, setOrphansOnly] = useState(false);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [sort, setSort] = useState<SortKey>('name');
    const [order, setOrder] = useState<'asc' | 'desc'>('asc');
    const [detailFile, setDetailFile] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);

    const parentRef = useRef<HTMLDivElement>(null);

    // Debounce search query
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(query), 350);
        return () => clearTimeout(t);
    }, [query]);

    const queryParams: AssetsQueryParams = {
        q: debouncedQ || undefined,
        personIds: chips.length > 0 ? chips.map((c) => c.id) : undefined,
        type: typeFilter,
        sort,
        order,
    };

    const { data, isLoading } = useAssets(queryParams);
    const deleteAsset = useDeleteGalleryAsset();

    // For orphans-only we filter client-side (simple boolean)
    const allAssets = data?.assets ?? [];
    const filtered = orphansOnly ? allAssets.filter(a => a.isOrphan) : allAssets;

    const rows: AssetListItem[][] = [];
    for (let i = 0; i < filtered.length; i += COLS) {
        rows.push(filtered.slice(i, i + COLS));
    }

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: useCallback(() => 260, []),
        overscan: 3,
    });

    const handleDelete = (filename: string, force: boolean) => {
        const wasOpen = detailFile === filename;
        const idx = filtered.findIndex(a => a.filename === filename);
        const next = filtered[idx + 1]?.filename ?? filtered[idx - 1]?.filename ?? null;
        setDeleteTarget(null);
        deleteAsset.mutate({ filename, force }, {
            onSuccess: () => {
                toast.success(`Deleted ${filename}`);
                if (wasOpen) setDetailFile(next);
            },
            onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete'),
        });
    };

    const handleNavigate = (filename: string) => setDetailFile(filename);

    const SortIcon = order === 'asc' ? ArrowUp : ArrowDown;

    const detailAsset = detailFile ? allAssets.find(a => a.filename === detailFile) ?? null : null;
    const deleteTargetAsset = deleteTarget ? allAssets.find(a => a.filename === deleteTarget) ?? null : null;
    const isOrphanDelete = deleteTargetAsset?.isOrphan ?? true;

    return (
        <div className="flex flex-col h-full">
            <TopBarActions>
                <div className="w-px h-5 bg-border shrink-0 mx-1" />
                {/* Search */}
                <AssetSearchBar
                    textValue={query}
                    onTextChange={setQuery}
                    selectedPeople={chips}
                    onAddPerson={(id, name) => setChips((prev) => prev.some((c) => c.id === id) ? prev : [...prev, { id, name }])}
                    onRemovePerson={(id) => setChips((prev) => prev.filter((c) => c.id !== id))}
                />
                {/* Type filter */}
                <div className="flex gap-1 shrink-0">
                    {(['all', 'image', 'document'] as const).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTypeFilter(t)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                typeFilter === t
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                        >
                            {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Documents'}
                        </button>
                    ))}
                </div>
                {/* Orphans toggle */}
                <button
                    type="button"
                    onClick={() => setOrphansOnly((v) => !v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0 ${
                        orphansOnly
                            ? 'bg-destructive text-destructive-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                >
                    Unlinked
                </button>
                {/* Sort */}
                <div className="flex items-center gap-1 shrink-0">
                    {(
                        [
                            { key: 'name', label: 'Name' },
                            { key: 'size', label: 'Size' },
                            { key: 'date', label: 'Date taken' },
                            { key: 'created', label: 'Added' },
                            { key: 'modified', label: 'Edited' },
                        ] as const
                    ).map(({ key: s, label }) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => {
                                if (sort === s) setOrder(o => o === 'asc' ? 'desc' : 'asc');
                                else { setSort(s); setOrder('asc'); }
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                                sort === s
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                        >
                            {label}
                            {sort === s
                                ? <SortIcon className="h-3 w-3" />
                                : <ArrowUpDown className="h-3 w-3 opacity-40" />
                            }
                        </button>
                    ))}
                </div>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    {filtered.length}
                    {filtered.length !== (data?.totalCount ?? 0)
                        ? ` / ${data?.totalCount ?? 0} assets`
                        : ' assets'}
                </span>
                <Button size="sm" className="shrink-0 h-8 gap-1.5" onClick={() => setUploadOpen(true)}>
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                </Button>
            </TopBarActions>

            {/* Gallery */}
            <div ref={parentRef} className="flex-1 overflow-auto p-4">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                        Loading assets…
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                        {(data?.totalCount ?? 0) === 0 ? 'No assets found.' : 'No assets match the current filter.'}
                    </div>
                ) : (
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const rowItems = rows[virtualRow.index];
                            return (
                                <div
                                    key={virtualRow.key}
                                    style={{
                                        position: 'absolute',
                                        top: virtualRow.start,
                                        left: 0,
                                        right: 0,
                                        height: virtualRow.size,
                                    }}
                                    className="grid grid-cols-3 gap-3 pb-3"
                                >
                                    {rowItems.map((asset) => (
                                        <AssetCard
                                            key={asset.filename}
                                            asset={asset}
                                            onOpen={setDetailFile}
                                            onDeleteRequest={setDeleteTarget}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Bulk Upload Dialog */}
            <BulkUploadDialog
                open={uploadOpen}
                onOpenChange={setUploadOpen}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['assets'] })}
            />

            {/* Asset Lightbox */}
            {detailAsset && (
                <AssetLightbox
                    filename={detailAsset.filename}
                    allFilenames={allAssets.map(a => a.filename)}
                    assetData={detailAsset}
                    onClose={() => setDetailFile(null)}
                    onNavigate={handleNavigate}
                    onDeleteRequest={setDeleteTarget}
                />
            )}

            {/* Delete confirm dialog */}
            <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete asset?</DialogTitle>
                        {isOrphanDelete ? (
                            <DialogDescription>
                                This will permanently delete <strong>{deleteTarget}</strong> from disk. This action cannot be undone.
                            </DialogDescription>
                        ) : (
                            <DialogDescription asChild>
                                <div className="space-y-2">
                                    <p>
                                        <strong>{deleteTarget}</strong> is still linked to{' '}
                                        {deleteTargetAsset && deleteTargetAsset.referencedBy.people.length > 0 && (
                                            <span>{deleteTargetAsset.referencedBy.people.length} {deleteTargetAsset.referencedBy.people.length === 1 ? 'person' : 'people'}</span>
                                        )}
                                        {deleteTargetAsset && deleteTargetAsset.referencedBy.people.length > 0 && deleteTargetAsset.referencedBy.stories.length > 0 && ' and '}
                                        {deleteTargetAsset && deleteTargetAsset.referencedBy.stories.length > 0 && (
                                            <span>{deleteTargetAsset.referencedBy.stories.length} {deleteTargetAsset.referencedBy.stories.length === 1 ? 'story' : 'stories'}</span>
                                        )}.
                                    </p>
                                    <p>Deleting it will remove all these links and permanently delete the file from disk. This action cannot be undone.</p>
                                </div>
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={deleteAsset.isPending}
                            onClick={() => deleteTarget && handleDelete(deleteTarget, !isOrphanDelete)}
                        >
                            {deleteAsset.isPending
                                ? 'Deleting…'
                                : isOrphanDelete
                                    ? 'Delete'
                                    : 'Delete & unlink all'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
