import { useState, useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAssets } from '@/api/hooks';
import type { AssetListItem, AssetsQueryParams } from '@/api/client';
import { assetType } from '@/lib/assetUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AssetSearchBar } from '@/components/AssetSearchBar';
import type { PersonChipData } from '@/components/AssetSearchBar';
import { FileText, Check, SortAsc, SortDesc, ArrowUpDown } from 'lucide-react';

interface AssetPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (filenames: string[]) => void;
    excludeFilenames?: string[];
    title?: string;
    /** Pre-populate the person chip filter when the dialog opens */
    preloadPersonChip?: PersonChipData;
}

const CELL_SIZE = 120;
const COLS = 3;

type SortKey = 'name' | 'size' | 'date' | 'created' | 'modified';
type TypeFilter = 'all' | 'image' | 'document';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'date', label: 'Date' },
    { key: 'created', label: 'Added' },
    { key: 'size', label: 'Size' },
];

/** Build query params — returns undefined when everything is at defaults so we share
 *  the existing `useAssets()` cache instead of making a duplicate request. */
function buildQueryParams(
    q: string,
    personIds: string[],
    typeFilter: TypeFilter,
    sortKey: SortKey,
    sortOrder: 'asc' | 'desc',
): AssetsQueryParams | undefined {
    const hasSearch = q.length > 0;
    const hasPersonFilter = personIds.length > 0;
    const hasFilter = typeFilter !== 'all';
    const hasSort = sortKey !== 'name' || sortOrder !== 'asc';
    if (!hasSearch && !hasPersonFilter && !hasFilter && !hasSort) return undefined;
    return {
        ...(hasSearch && { q }),
        ...(hasPersonFilter && { personIds }),
        ...(hasFilter && { type: typeFilter }),
        ...(hasSort && { sort: sortKey, order: sortOrder }),
    };
}

export function AssetPickerDialog({
    open,
    onOpenChange,
    onConfirm,
    excludeFilenames = [],
    title = 'Link Assets',
    preloadPersonChip,
}: AssetPickerDialogProps) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [chips, setChips] = useState<PersonChipData[]>([]);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [selected, setSelected] = useState<string[]>([]);
    const parentRef = useRef<HTMLDivElement>(null);

    // Reset all state when dialog closes
    useEffect(() => {
        if (!open) {
            setQuery('');
            setDebouncedQuery('');
            setChips([]);
            setTypeFilter('all');
            setSortKey('name');
            setSortOrder('asc');
            setSelected([]);
        }
    }, [open]);

    // Seed preload chip when dialog opens (fires after the reset above)
    useEffect(() => {
        if (open && preloadPersonChip) {
            setChips([preloadPersonChip]);
        }
    // preloadPersonChip intentionally omitted — only react to the open transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 350);
        return () => clearTimeout(t);
    }, [query]);

    const personIds = chips.map((c) => c.id);
    const queryParams = buildQueryParams(debouncedQuery.trim(), personIds, typeFilter, sortKey, sortOrder);
    // undefined → reuses the shared `useAssets()` cache (all assets, default sort)
    const { data, isLoading } = useAssets(queryParams);
    const allAssets = data?.assets ?? [];

    // Group into rows of COLS
    const rows: AssetListItem[][] = [];
    for (let i = 0; i < allAssets.length; i += COLS) {
        rows.push(allAssets.slice(i, i + COLS));
    }

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => CELL_SIZE + 8,
        overscan: 3,
    });

    const toggleSort = useCallback((key: SortKey) => {
        if (sortKey === key) {
            setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('asc');
        }
    }, [sortKey]);

    const toggleSelect = (filename: string) => {
        if (excludeFilenames.includes(filename)) return;
        setSelected(prev =>
            prev.includes(filename) ? prev.filter(f => f !== filename) : [...prev, filename]
        );
    };

    const handleConfirm = () => {
        if (selected.length === 0) return;
        onConfirm(selected);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg flex flex-col gap-0 p-0">
                <DialogHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>

                {/* Toolbar */}
                <div className="px-4 py-2.5 border-b border-border space-y-2 shrink-0">
                    {/* Search */}
                    <div className="flex">
                        <AssetSearchBar
                            textValue={query}
                            onTextChange={setQuery}
                            selectedPeople={chips}
                            onAddPerson={(id, name) => setChips((prev) => prev.some((c) => c.id === id) ? prev : [...prev, { id, name }])}
                            onRemovePerson={(id) => setChips((prev) => prev.filter((c) => c.id !== id))}
                        />
                    </div>

                    {/* Type filter + sort */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {(['all', 'image', 'document'] as TypeFilter[]).map(t => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setTypeFilter(t)}
                                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                    typeFilter === t
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                }`}
                            >
                                {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'Documents'}
                            </button>
                        ))}
                        <div className="ml-auto flex items-center gap-1">
                            {SORT_OPTIONS.map(opt => {
                                const isActive = sortKey === opt.key;
                                return (
                                    <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => toggleSort(opt.key)}
                                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs transition-colors ${
                                            isActive
                                                ? 'text-foreground font-medium'
                                                : 'text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        {opt.label}
                                        {isActive
                                            ? (sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />)
                                            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Virtualized grid — explicit height so the virtualizer always has a stable measurement */}
                <div ref={parentRef} className="h-[340px] overflow-auto shrink-0 px-1 py-1">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            Loading…
                        </div>
                    ) : allAssets.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                            {(debouncedQuery || chips.length > 0) ? 'No assets match your search' : 'No assets found'}
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
                                            const isSelected = selected.includes(asset.filename);
                                            const isImg = assetType(asset.filename) === 'image';
                                            return (
                                                <button
                                                    key={asset.filename}
                                                    type="button"
                                                    onClick={() => toggleSelect(asset.filename)}
                                                    disabled={isExcluded}
                                                    className={`relative rounded-md border overflow-hidden flex flex-col items-center justify-center transition-all ${
                                                        isExcluded
                                                            ? 'opacity-50 cursor-not-allowed border-border bg-muted'
                                                            : isSelected
                                                            ? 'border-primary ring-2 ring-primary/30 bg-primary/5 cursor-pointer'
                                                            : 'border-border bg-muted hover:border-primary/60 hover:bg-primary/5 cursor-pointer'
                                                    }`}
                                                    style={{ height: CELL_SIZE }}
                                                >
                                                    {isImg ? (
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
                                                    {/* Selected / excluded overlay */}
                                                    {(isSelected || isExcluded) && (
                                                        <div className={`absolute inset-0 flex items-center justify-center ${isExcluded ? 'bg-black/40' : 'bg-primary/20'}`}>
                                                            <div className={`rounded-full p-0.5 ${isExcluded ? 'bg-white/80' : 'bg-primary'}`}>
                                                                <Check className={`h-4 w-4 ${isExcluded ? 'text-muted-foreground' : 'text-primary-foreground'}`} />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Filename label */}
                                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                                                        <p className="text-[8px] text-white truncate">{asset.metadata.name ?? asset.filename}</p>
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

                <DialogFooter className="px-4 py-3 border-t border-border shrink-0">
                    <div className="flex items-center gap-2 w-full">
                        <span className="text-xs text-muted-foreground flex-1">
                            {selected.length > 0 ? `${selected.length} selected` : 'Click assets to select'}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button size="sm" disabled={selected.length === 0} onClick={handleConfirm}>
                            Link {selected.length > 0 ? `${selected.length} ` : ''}asset{selected.length !== 1 ? 's' : ''}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
