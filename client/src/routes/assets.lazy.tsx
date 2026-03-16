import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAssets, useUpdateAssetMeta, useDeleteGalleryAsset, useLinkAsset, useUnlinkAsset } from '@/api/hooks';
import type { AssetListItem } from '@/api/client';
import type { AssetsQueryParams } from '@/api/client';
import { assetType } from '@/lib/assetUtils';
import { PersonChip } from '@/components/PersonChip';
import { PersonSearchCombobox } from '@/components/PersonSearchCombobox';
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
import { Button } from '@/components/ui/button';
import {
    Search, FileText, Trash2, ZoomIn, ExternalLink,
    ChevronLeft, ChevronRight, X, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';

export const Route = createLazyFileRoute('/assets')({
    component: AssetGallery,
});

const COLS = 3;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif', '.svg']);

function isImage(filename: string): boolean {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 && IMAGE_EXTS.has(filename.slice(dot).toLowerCase());
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── AssetCard ─────────────────────────────────────────────────────────────

interface AssetCardProps {
    asset: AssetListItem;
    onOpen: (filename: string) => void;
    onDelete: (filename: string) => void;
}

function AssetCard({ asset, onOpen, onDelete }: AssetCardProps) {
    const type = assetType(asset.filename);
    const isImg = type === 'image';
    const ext = asset.filename.split('.').pop()?.toUpperCase() ?? 'FILE';

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            {/* Thumbnail — 4:3 aspect ratio, object-contain on neutral bg */}
            <div className="group relative bg-muted/50 overflow-hidden" style={{ aspectRatio: '4/3' }}>
                {isImg ? (
                    <img
                        src={`/assets/${asset.filename}`}
                        alt={asset.filename}
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
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Orphan</Badge>
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
                    {asset.isOrphan && (
                        <button
                            type="button"
                            title="Delete orphan"
                            onClick={() => onDelete(asset.filename)}
                            className="p-1.5 rounded-full bg-white/20 hover:bg-red-500/70 text-white"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Info panel */}
            <div className="px-2 py-2 flex flex-col gap-1">
                <p className="text-[10px] text-foreground font-medium truncate" title={asset.filename}>
                    {asset.filename}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{ext}</Badge>
                    <span className="text-[9px] text-muted-foreground">{formatSize(asset.size)}</span>
                    {asset.metadata.date_taken && (
                        <span className="text-[9px] text-muted-foreground">{asset.metadata.date_taken}</span>
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
                    <Link
                        to="/stories/$id"
                        params={{ id: asset.referencedBy.stories[0] }}
                        className="text-[9px] text-primary flex items-center gap-0.5 hover:underline"
                    >
                        <ExternalLink className="h-2.5 w-2.5" />
                        {asset.referencedBy.stories.length === 1
                            ? '1 story'
                            : `${asset.referencedBy.stories.length} stories`}
                    </Link>
                )}
            </div>
        </div>
    );
}

// ── AssetDetailModal ───────────────────────────────────────────────────────

interface AssetDetailModalProps {
    asset: AssetListItem;
    allAssets: AssetListItem[];
    onClose: () => void;
    onNavigate: (filename: string) => void;
    onDeleteRequest: (filename: string) => void;
}

function AssetDetailModal({ asset, allAssets, onClose, onNavigate, onDeleteRequest }: AssetDetailModalProps) {
    const updateMeta = useUpdateAssetMeta();
    const linkAsset = useLinkAsset();
    const unlinkAsset = useUnlinkAsset();

    const [description, setDescription] = useState(asset.metadata.description ?? '');
    const [dateTaken, setDateTaken] = useState(asset.metadata.date_taken ?? '');
    const [editingDesc, setEditingDesc] = useState(false);

    // Keep local state in sync when asset changes (navigation)
    useEffect(() => {
        setDescription(asset.metadata.description ?? '');
        setDateTaken(asset.metadata.date_taken ?? '');
        setEditingDesc(false);
    }, [asset.filename, asset.metadata.description, asset.metadata.date_taken]);

    const imageAssets = allAssets.filter(a => isImage(a.filename));
    const currentImageIdx = imageAssets.findIndex(a => a.filename === asset.filename);
    const hasPrev = currentImageIdx > 0;
    const hasNext = currentImageIdx < imageAssets.length - 1;
    const isImg = isImage(asset.filename);

    // Keyboard nav
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (!isImg) return;
            if (e.key === 'ArrowLeft' && hasPrev) onNavigate(imageAssets[currentImageIdx - 1].filename);
            if (e.key === 'ArrowRight' && hasNext) onNavigate(imageAssets[currentImageIdx + 1].filename);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isImg, hasPrev, hasNext, currentImageIdx, imageAssets, onClose, onNavigate]);

    const saveDescription = () => {
        updateMeta.mutate(
            { filename: asset.filename, meta: { description: description.trim() || undefined } },
            {
                onSuccess: () => { toast.success('Description saved.'); setEditingDesc(false); },
                onError: () => toast.error('Failed to save description.'),
            }
        );
    };

    const saveDateTaken = (val: string) => {
        setDateTaken(val);
        updateMeta.mutate(
            { filename: asset.filename, meta: { date_taken: val.trim() || undefined } },
            { onError: () => toast.error('Failed to save date.') }
        );
    };

    const handleLinkPerson = (personId: string) => {
        linkAsset.mutate(
            { personId, filename: asset.filename },
            {
                onSuccess: () => toast.success('Person linked.'),
                onError: () => toast.error('Failed to link person.'),
            }
        );
    };

    const handleUnlinkPerson = (personId: string) => {
        unlinkAsset.mutate(
            { personId, filename: asset.filename },
            {
                onSuccess: () => toast.success('Person unlinked.'),
                onError: () => toast.error('Failed to unlink person.'),
            }
        );
    };

    const ext = asset.filename.split('.').pop()?.toUpperCase() ?? 'FILE';

    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-background rounded-xl shadow-2xl flex overflow-hidden w-full max-w-5xl max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Left: image / file display */}
                <div className="relative flex-1 bg-black/90 flex items-center justify-center min-w-0 min-h-[400px]">
                    {isImg ? (
                        <img
                            src={`/assets/${asset.filename}`}
                            alt={asset.filename}
                            className="max-w-full max-h-[80vh] object-contain"
                        />
                    ) : (
                        <div className="flex flex-col items-center gap-4 text-white p-8">
                            <FileText className="h-24 w-24 opacity-40" />
                            <p className="text-sm opacity-70">{asset.filename}</p>
                            <a
                                href={`/assets/${asset.filename}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white underline"
                            >
                                <ExternalLink className="h-3.5 w-3.5" /> Open file
                            </a>
                        </div>
                    )}

                    {/* Prev / Next arrows (image only) */}
                    {isImg && hasPrev && (
                        <button
                            type="button"
                            className="absolute left-3 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); onNavigate(imageAssets[currentImageIdx - 1].filename); }}
                            aria-label="Previous image"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                    )}
                    {isImg && hasNext && (
                        <button
                            type="button"
                            className="absolute right-3 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); onNavigate(imageAssets[currentImageIdx + 1].filename); }}
                            aria-label="Next image"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    )}

                    {/* Counter */}
                    {isImg && imageAssets.length > 1 && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/60 bg-black/40 rounded-full px-2 py-0.5">
                            {currentImageIdx + 1} / {imageAssets.length}
                        </div>
                    )}
                </div>

                {/* Right: metadata panel */}
                <div className="w-72 shrink-0 flex flex-col border-l border-border overflow-y-auto">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-border">
                        <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="text-[10px] shrink-0">{ext}</Badge>
                            <span className="text-xs text-muted-foreground truncate">{formatSize(asset.size)}</span>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded hover:bg-muted text-muted-foreground shrink-0"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="flex-1 p-3 space-y-4 overflow-y-auto">
                        {/* Filename */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Filename</p>
                            <p className="text-sm font-mono break-all">{asset.filename}</p>
                        </div>

                        {/* Date taken */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Date taken</p>
                            <Input
                                value={dateTaken}
                                onChange={(e) => setDateTaken(e.target.value)}
                                onBlur={(e) => saveDateTaken(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveDateTaken(dateTaken); }}
                                placeholder="e.g. 1945-06"
                                className="h-7 text-xs"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                            {editingDesc ? (
                                <div className="space-y-1">
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDescription(); } if (e.key === 'Escape') setEditingDesc(false); }}
                                        className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                                        rows={3}
                                        autoFocus
                                    />
                                    <div className="flex gap-1">
                                        <Button size="sm" className="h-6 text-xs px-2" onClick={saveDescription}>Save</Button>
                                        <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setEditingDesc(false)}>Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setEditingDesc(true)}
                                    className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {description || <span className="italic opacity-50">Add description…</span>}
                                </button>
                            )}
                        </div>

                        {/* Associated people */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">People in this photo</p>
                            <div className="space-y-1 mb-2">
                                {asset.referencedBy.people.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic">No people linked</p>
                                ) : (
                                    asset.referencedBy.people.map((pid) => (
                                        <div key={pid} className="flex items-center gap-1.5">
                                            <PersonChip id={pid} className="flex-1 text-xs" />
                                            <button
                                                type="button"
                                                title="Remove link"
                                                onClick={() => handleUnlinkPerson(pid)}
                                                className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                            <PersonSearchCombobox
                                onSelect={handleLinkPerson}
                                excludeIds={asset.referencedBy.people}
                                placeholder="Link a person…"
                                className="w-full"
                            />
                        </div>

                        {/* Associated stories */}
                        {asset.referencedBy.stories.length > 0 && (
                            <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Stories</p>
                                <div className="space-y-1">
                                    {asset.referencedBy.stories.map((sid) => (
                                        <Link
                                            key={sid}
                                            to="/stories/$id"
                                            params={{ id: sid }}
                                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                                            onClick={onClose}
                                        >
                                            <ExternalLink className="h-3 w-3 shrink-0" />
                                            {sid}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 border-t border-border">
                        {asset.isOrphan && (
                            <div className="space-y-2">
                                <Badge variant="destructive" className="text-xs w-full justify-center">Orphan — not linked to anyone</Badge>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    className="w-full h-7 text-xs"
                                    onClick={() => { onDeleteRequest(asset.filename); onClose(); }}
                                >
                                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete file
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── AssetGallery page ──────────────────────────────────────────────────────

type SortKey = 'name' | 'size' | 'date';
type TypeFilter = 'all' | 'image' | 'document';

function AssetGallery() {
    const [query, setQuery] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [orphansOnly, setOrphansOnly] = useState(false);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [sort, setSort] = useState<SortKey>('name');
    const [order, setOrder] = useState<'asc' | 'desc'>('asc');
    const [detailFile, setDetailFile] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const parentRef = useRef<HTMLDivElement>(null);

    // Debounce search query
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(query), 350);
        return () => clearTimeout(t);
    }, [query]);

    const queryParams: AssetsQueryParams = {
        q: debouncedQ || undefined,
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
        estimateSize: useCallback(() => {
            // Card height = container_width/3 * 3/4 (aspect) + info ~72px + gap
            return 260;
        }, []),
        overscan: 3,
    });

    const handleDelete = (filename: string) => {
        deleteAsset.mutate(filename, {
            onSuccess: () => toast.success(`Deleted ${filename}`),
            onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete'),
        });
        setDeleteTarget(null);
    };

    const handleNavigate = (filename: string) => setDetailFile(filename);

    const SortIcon = order === 'asc' ? ArrowUp : ArrowDown;

    const detailAsset = detailFile ? allAssets.find(a => a.filename === detailFile) ?? null : null;

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0 flex-wrap">
                <h1 className="text-base font-semibold shrink-0">Assets</h1>

                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, description, person…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="pl-7 h-8 text-sm"
                    />
                </div>

                {/* Type filter */}
                <div className="flex gap-1">
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
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        orphansOnly
                            ? 'bg-destructive text-destructive-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                >
                    Orphans
                </button>

                {/* Sort */}
                <div className="flex items-center gap-1">
                    {(['name', 'size', 'date'] as const).map((s) => (
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
                            {s === 'name' ? 'Name' : s === 'size' ? 'Size' : 'Date'}
                            {sort === s
                                ? <SortIcon className="h-3 w-3" />
                                : <ArrowUpDown className="h-3 w-3 opacity-40" />
                            }
                        </button>
                    ))}
                </div>

                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    {filtered.length} {filtered.length !== (data?.totalCount ?? 0) ? `/ ${data?.totalCount ?? 0}` : ''}
                </span>
            </div>

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
                                            onDelete={setDeleteTarget}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Asset Detail Modal */}
            {detailAsset && (
                <AssetDetailModal
                    asset={detailAsset}
                    allAssets={allAssets}
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
                        <DialogDescription>
                            This will permanently delete <strong>{deleteTarget}</strong> from disk. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteTarget && handleDelete(deleteTarget)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
