import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAssets, useUpdateAssetMeta, useDeleteGalleryAsset } from '@/api/hooks';
import type { AssetListItem } from '@/api/client';
import { assetType } from '@/lib/assetUtils';
import { PersonChip } from '@/components/PersonChip';
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
import { Search, FileText, Trash2, ZoomIn, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

export const Route = createLazyFileRoute('/assets')({
    component: AssetGallery,
});

const COLS = 3;
const CELL_HEIGHT = 200;
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
    onLightbox: (filename: string) => void;
    onDelete: (filename: string) => void;
}

function AssetCard({ asset, onLightbox, onDelete }: AssetCardProps) {
    const [editingCaption, setEditingCaption] = useState(false);
    const [captionValue, setCaptionValue] = useState(asset.metadata.caption ?? '');
    const updateMeta = useUpdateAssetMeta();
    const type = assetType(asset.filename);
    const isImg = type === 'image';

    const saveCaption = () => {
        const caption = captionValue.trim();
        updateMeta.mutate(
            { filename: asset.filename, meta: { caption: caption || undefined } },
            {
                onSuccess: () => { toast.success('Caption saved.'); setEditingCaption(false); },
                onError: () => toast.error('Failed to save caption.'),
            }
        );
    };

    return (
        <div className="group relative rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            {/* Thumbnail */}
            <div className="relative bg-muted overflow-hidden flex-shrink-0" style={{ height: 140 }}>
                {isImg ? (
                    <img
                        src={`/assets/${asset.filename}`}
                        alt={asset.filename}
                        className="object-cover w-full h-full"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full gap-2 py-4">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground text-center break-all px-2 leading-tight">
                            {asset.filename}
                        </span>
                    </div>
                )}

                {/* Orphan badge */}
                {asset.isOrphan && (
                    <div className="absolute top-1.5 right-1.5">
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0">Orphan</Badge>
                    </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                        type="button"
                        title="View"
                        onClick={() => onLightbox(asset.filename)}
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
            <div className="px-2 py-1.5 space-y-1 flex-1">
                <p className="text-[10px] text-muted-foreground truncate" title={asset.filename}>
                    {asset.filename}
                </p>
                <p className="text-[9px] text-muted-foreground/70">{formatSize(asset.size)}</p>

                {/* Caption */}
                {editingCaption ? (
                    <div className="flex gap-1">
                        <Input
                            value={captionValue}
                            onChange={(e) => setCaptionValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveCaption();
                                if (e.key === 'Escape') setEditingCaption(false);
                            }}
                            onBlur={saveCaption}
                            className="h-6 text-[10px] px-1.5"
                            autoFocus
                        />
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => { setCaptionValue(asset.metadata.caption ?? ''); setEditingCaption(true); }}
                        className="text-[10px] text-left text-muted-foreground hover:text-foreground transition-colors w-full truncate"
                        title="Click to edit caption"
                    >
                        {asset.metadata.caption || <span className="italic opacity-50">Add caption…</span>}
                    </button>
                )}

                {/* Referenced by people */}
                {asset.referencedBy.people.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                        {asset.referencedBy.people.slice(0, 3).map((pid) => (
                            <PersonChip key={pid} id={pid} className="text-[9px]" />
                        ))}
                        {asset.referencedBy.people.length > 3 && (
                            <span className="text-[9px] text-muted-foreground">+{asset.referencedBy.people.length - 3}</span>
                        )}
                    </div>
                )}

                {/* Tagged people */}
                {asset.metadata.tagged_people.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 items-center">
                        <span className="text-[9px] text-muted-foreground">Tagged:</span>
                        {asset.metadata.tagged_people.slice(0, 2).map((pid) => (
                            <PersonChip key={pid} id={pid} className="text-[9px]" />
                        ))}
                    </div>
                )}

                {/* Story links */}
                {asset.referencedBy.stories.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                        {asset.referencedBy.stories.slice(0, 2).map((sid) => (
                            <Link
                                key={sid}
                                to="/stories/$id"
                                params={{ id: sid }}
                                className="text-[9px] text-primary hover:underline flex items-center gap-0.5"
                            >
                                <ExternalLink className="h-2.5 w-2.5" />
                                story
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Lightbox ──────────────────────────────────────────────────────────────

function Lightbox({ filename, onClose }: { filename: string; onClose: () => void }) {
    const img = isImage(filename);
    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
            onClick={onClose}
        >
            <div className="max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
                {img ? (
                    <img
                        src={`/assets/${filename}`}
                        alt={filename}
                        className="max-h-[85vh] max-w-full object-contain rounded"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-4 text-white">
                        <FileText className="h-20 w-20 opacity-60" />
                        <p className="text-sm">{filename}</p>
                        <a
                            href={`/assets/${filename}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline"
                        >
                            Open file
                        </a>
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={onClose}
                className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl"
                aria-label="Close lightbox"
            >
                ✕
            </button>
        </div>
    );
}

// ── AssetGallery page ──────────────────────────────────────────────────────

function AssetGallery() {
    const { data, isLoading } = useAssets();
    const deleteAsset = useDeleteGalleryAsset();

    const [query, setQuery] = useState('');
    const [orphansOnly, setOrphansOnly] = useState(false);
    const [sort, setSort] = useState<'name' | 'size'>('name');
    const [lightboxFile, setLightboxFile] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const parentRef = useRef<HTMLDivElement>(null);

    const allAssets = data?.assets ?? [];

    const filtered = allAssets
        .filter((a) => {
            if (orphansOnly && !a.isOrphan) return false;
            if (query && !a.filename.toLowerCase().includes(query.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (sort === 'size') return b.size - a.size;
            return a.filename.localeCompare(b.filename);
        });

    const rows: AssetListItem[][] = [];
    for (let i = 0; i < filtered.length; i += COLS) {
        rows.push(filtered.slice(i, i + COLS));
    }

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => CELL_HEIGHT + 8,
        overscan: 3,
    });

    const handleDelete = (filename: string) => {
        deleteAsset.mutate(filename, {
            onSuccess: () => toast.success(`Deleted ${filename}`),
            onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete'),
        });
        setDeleteTarget(null);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0 flex-wrap">
                <h1 className="text-base font-semibold shrink-0">Assets</h1>
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Search…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="pl-7 h-8 text-sm"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => setOrphansOnly((v) => !v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        orphansOnly
                            ? 'bg-destructive text-destructive-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                >
                    Orphans only
                </button>
                <div className="flex gap-1">
                    {(['name', 'size'] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSort(s)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                sort === s
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                        >
                            {s === 'name' ? 'Name' : 'Size'}
                        </button>
                    ))}
                </div>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    {filtered.length} / {allAssets.length}
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
                        {allAssets.length === 0 ? 'No assets found.' : 'No assets match the current filter.'}
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
                                            onLightbox={setLightboxFile}
                                            onDelete={setDeleteTarget}
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Lightbox */}
            {lightboxFile && <Lightbox filename={lightboxFile} onClose={() => setLightboxFile(null)} />}

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
