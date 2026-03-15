import { useState, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAssets } from '@/api/hooks';
import type { AssetListItem } from '@/api/client';
import { assetType } from '@/lib/assetUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Search, FileText, Check } from 'lucide-react';

interface AssetPickerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (filename: string) => void;
    excludeFilenames?: string[];
    title?: string;
}

const CELL_SIZE = 120;
const COLS = 3;

export function AssetPickerDialog({
    isOpen,
    onClose,
    onSelect,
    excludeFilenames = [],
    title = 'Pick an Asset',
}: AssetPickerDialogProps) {
    const [query, setQuery] = useState('');
    const [filterImages, setFilterImages] = useState(false);
    const parentRef = useRef<HTMLDivElement>(null);

    const { data, isLoading } = useAssets();
    const allAssets = data?.assets ?? [];

    const filtered = allAssets.filter((a: AssetListItem) => {
        if (filterImages && assetType(a.filename) !== 'image') return false;
        if (query && !a.filename.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
    });

    // Group into rows of COLS
    const rows: AssetListItem[][] = [];
    for (let i = 0; i < filtered.length; i += COLS) {
        rows.push(filtered.slice(i, i + COLS));
    }

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => CELL_SIZE + 8,
        overscan: 3,
    });

    const handleSelect = (filename: string) => {
        if (excludeFilenames.includes(filename)) return;
        onSelect(filename);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                {/* Search + filter */}
                <div className="flex gap-2 items-center shrink-0">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search assets…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="pl-7 h-8 text-sm"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setFilterImages((v) => !v)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0 ${
                            filterImages
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                    >
                        Images only
                    </button>
                </div>

                {/* Virtualized grid */}
                <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            Loading…
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            No assets found
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
                                        className="grid grid-cols-3 gap-2 px-1 pb-2"
                                    >
                                        {rowItems.map((asset) => {
                                            const isExcluded = excludeFilenames.includes(asset.filename);
                                            const isImage = assetType(asset.filename) === 'image';
                                            return (
                                                <button
                                                    key={asset.filename}
                                                    type="button"
                                                    onClick={() => handleSelect(asset.filename)}
                                                    disabled={isExcluded}
                                                    className={`relative rounded-md border border-border bg-muted overflow-hidden flex flex-col items-center justify-center transition-colors ${
                                                        isExcluded
                                                            ? 'opacity-50 cursor-not-allowed'
                                                            : 'hover:border-primary hover:bg-primary/5 cursor-pointer'
                                                    }`}
                                                    style={{ height: CELL_SIZE }}
                                                >
                                                    {isImage ? (
                                                        <img
                                                            src={`/assets/${asset.filename}`}
                                                            alt={asset.filename}
                                                            className="object-cover w-full h-full"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-1 p-2">
                                                            <FileText className="h-7 w-7 text-muted-foreground" />
                                                            <span className="text-[9px] text-muted-foreground text-center break-all leading-tight line-clamp-2">
                                                                {asset.filename}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {isExcluded && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                                            <Check className="h-5 w-5 text-white" />
                                                        </div>
                                                    )}
                                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                                                        <p className="text-[8px] text-white truncate">{asset.filename}</p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
