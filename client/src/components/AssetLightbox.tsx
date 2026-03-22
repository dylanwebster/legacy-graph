import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useUpdateAssetMeta, useLinkAsset, useUnlinkAsset, usePlacesSearch } from '@/api/hooks';
import type { AssetListItem } from '@/api/client';
import type { Place } from '@/api/people';
import { assetType } from '@/lib/assetUtils';
import { PersonChip } from '@/components/PersonChip';
import { PersonSearchCombobox } from '@/components/PersonSearchCombobox';
import { SmartDateInput, parseToISO } from '@/components/SmartDateInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    ChevronLeft, ChevronRight, X, FileText, ExternalLink,
    Pencil, Check, Trash2, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';

// Inline place search combobox (mirrors EventEditorDialog pattern)
function PlaceCombobox({
    value,
    onChange,
    onSelect,
}: {
    value: string;
    onChange: (q: string) => void;
    onSelect: (p: Place) => void;
}) {
    const [debounced, setDebounced] = useState('');
    const [open, setOpen] = useState(false);
    const [resolved, setResolved] = useState<Place | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), 350);
        return () => clearTimeout(t);
    }, [value]);

    const { data: places } = usePlacesSearch(debounced);

    const handleSelect = (p: Place) => {
        onChange(p.name);
        setResolved(p);
        onSelect(p);
        setOpen(false);
    };

    const displayLat = resolved?.lat != null
        ? `${Math.abs(resolved.lat).toFixed(2)}°${resolved.lat >= 0 ? 'N' : 'S'}, ${Math.abs(resolved.lng ?? 0).toFixed(2)}°${(resolved.lng ?? 0) >= 0 ? 'E' : 'W'}`
        : null;

    return (
        <div className="relative">
            <Input
                placeholder="City, Country"
                value={value}
                onChange={(e) => { onChange(e.target.value); setResolved(null); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                className="h-7 text-xs"
                autoFocus
            />
            {open && debounced.length >= 2 && (places ?? []).length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-40 overflow-auto">
                    {(places ?? []).map((p, i) => (
                        <button
                            key={i}
                            type="button"
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 text-left"
                            onMouseDown={() => handleSelect(p)}
                        >
                            <span className="truncate flex-1">{p.name}</span>
                            {!!p.countryCode && <span className="text-muted-foreground shrink-0">{p.countryCode}</span>}
                        </button>
                    ))}
                </div>
            )}
            {!!displayLat && (
                <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">{displayLat}</p>
            )}
        </div>
    );
}

export interface AssetLightboxProps {
    filename: string;
    /** Ordered list of all navigable filenames */
    allFilenames: string[];
    onClose: () => void;
    onNavigate: (filename: string) => void;
    /** Enriched asset data from /api/assets — provides size, referencedBy, isOrphan */
    assetData?: AssetListItem;
    /** Extra content rendered as an absolute overlay on the left panel (e.g. primary photo bar) */
    overlayContent?: ReactNode;
    /** Called when user clicks the delete button — parent shows the confirmation dialog */
    onDeleteRequest?: (filename: string) => void;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileDisplayName(filename: string, name?: string): string {
    if (name) return name;
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    return base.replace(/[_-]/g, ' ');
}

export function AssetLightbox({
    filename,
    allFilenames,
    onClose,
    onNavigate,
    assetData,
    overlayContent,
    onDeleteRequest,
}: AssetLightboxProps) {
    const updateMeta = useUpdateAssetMeta();
    const linkAsset = useLinkAsset();
    const unlinkAsset = useUnlinkAsset();

    const [assetName, setAssetName] = useState(assetData?.metadata.name ?? '');
    const [editingName, setEditingName] = useState(false);
    const [description, setDescription] = useState(assetData?.metadata.description ?? '');
    const [dateVal, setDateVal] = useState(assetData?.metadata.date ?? '');
    const [editingDate, setEditingDate] = useState(false);
    const [editingDesc, setEditingDesc] = useState(false);
    const [locationQuery, setLocationQuery] = useState(assetData?.metadata.location?.name ?? '');
    const [locationPlace, setLocationPlace] = useState<Place | null>(assetData?.metadata.location ?? null);
    const [editingLocation, setEditingLocation] = useState(false);
    const [textContent, setTextContent] = useState<string | null>(null);

    // Sync editing state when asset or its metadata changes
    useEffect(() => {
        setAssetName(assetData?.metadata.name ?? '');
        setDescription(assetData?.metadata.description ?? '');
        setDateVal(assetData?.metadata.date ?? '');
        setLocationQuery(assetData?.metadata.location?.name ?? '');
        setLocationPlace(assetData?.metadata.location ?? null);
        setEditingName(false);
        setEditingDate(false);
        setEditingDesc(false);
        setEditingLocation(false);
        setTextContent(null);
    }, [filename, assetData?.metadata.name, assetData?.metadata.description, assetData?.metadata.date, assetData?.metadata.location]);

    const type = assetType(filename);

    // Fetch inline content for text/markdown assets
    useEffect(() => {
        if (type !== 'text' && type !== 'markdown') { setTextContent(null); return; }
        fetch(`/assets/${filename}`)
            .then(r => r.text())
            .then(setTextContent)
            .catch(() => setTextContent('(Failed to load file)'));
    }, [filename, type]);

    // Keyboard navigation (ESC, arrows)
    const currentIdx = allFilenames.indexOf(filename);
    const hasPrev = currentIdx > 0;
    const hasNext = currentIdx < allFilenames.length - 1;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key === 'ArrowLeft' && hasPrev) onNavigate(allFilenames[currentIdx - 1]);
            if (e.key === 'ArrowRight' && hasNext) onNavigate(allFilenames[currentIdx + 1]);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [hasPrev, hasNext, currentIdx, allFilenames, onClose, onNavigate]);

    const ext = filename.split('.').pop()?.toUpperCase() ?? 'FILE';
    const displayName = fileDisplayName(filename, assetData?.metadata.name);

    const saveName = () => {
        const trimmed = assetName.trim();
        updateMeta.mutate(
            { filename, meta: { name: trimmed || undefined } },
            {
                onSuccess: () => { toast.success('Name saved.'); setEditingName(false); },
                onError: () => toast.error('Failed to save name.'),
            }
        );
    };

    const saveDescription = () => {
        updateMeta.mutate(
            { filename, meta: { description: description.trim() || undefined } },
            {
                onSuccess: () => { toast.success('Description saved.'); setEditingDesc(false); },
                onError: () => toast.error('Failed to save description.'),
            }
        );
    };

    const saveLocation = () => {
        const place = locationPlace ?? (locationQuery.trim() ? { name: locationQuery.trim() } : undefined);
        updateMeta.mutate(
            { filename, meta: { location: place } },
            {
                onSuccess: () => { toast.success('Location saved.'); setEditingLocation(false); },
                onError: () => toast.error('Failed to save location.'),
            }
        );
    };

    const saveDate = () => {
        const trimmed = dateVal.trim();
        const iso = parseToISO(trimmed);
        // Block save when user typed something we can't parse
        if (trimmed && !iso) return;
        updateMeta.mutate(
            { filename, meta: { date: iso ?? undefined } },
            {
                onSuccess: () => { toast.success('Date saved.'); setEditingDate(false); },
                onError: () => toast.error('Failed to save date.'),
            }
        );
    };

    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-background rounded-xl shadow-2xl flex overflow-hidden w-full max-w-5xl h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Left: asset display */}
                <div className="relative flex-1 bg-black/90 flex items-center justify-center min-w-0">
                    {type === 'pdf' ? (
                        <iframe
                            src={`/assets/${filename}`}
                            title={displayName}
                            className="absolute inset-0 w-full h-full"
                        />
                    ) : type === 'text' ? (
                        <div className="w-full h-full overflow-auto p-6 text-white/90" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm font-medium">{displayName}</span>
                                <a
                                    href={`/assets/${filename}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-white/60 hover:text-white"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-3 w-3" /> Open
                                </a>
                            </div>
                            <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-white/80">
                                {textContent ?? 'Loading…'}
                            </pre>
                        </div>
                    ) : type === 'markdown' ? (
                        <div className="w-full h-full overflow-auto p-6 bg-background" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm font-medium">{displayName}</span>
                                <a
                                    href={`/assets/${filename}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-3 w-3" /> Open
                                </a>
                            </div>
                            {textContent == null
                                ? <p className="text-sm text-muted-foreground">Loading…</p>
                                : <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <ReactMarkdown>{textContent}</ReactMarkdown>
                                </div>
                            }
                        </div>
                    ) : type === 'image' ? (
                        <img
                            src={`/assets/${filename}`}
                            alt={displayName}
                            className="max-w-full max-h-full object-contain"
                        />
                    ) : (
                        <div className="flex flex-col items-center gap-4 text-white p-8">
                            <FileText className="h-24 w-24 opacity-40" />
                            <p className="text-sm opacity-70">{displayName}</p>
                            <a
                                href={`/assets/${filename}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white underline"
                            >
                                <ExternalLink className="h-3.5 w-3.5" /> Open file
                            </a>
                        </div>
                    )}

                    {/* Caller-provided overlay (e.g. primary photo bar on person page) */}
                    {overlayContent}

                    {/* Prev / Next arrows */}
                    {hasPrev && (
                        <button
                            type="button"
                            className="absolute left-3 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); onNavigate(allFilenames[currentIdx - 1]); }}
                            aria-label="Previous asset"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                    )}
                    {hasNext && (
                        <button
                            type="button"
                            className="absolute right-3 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); onNavigate(allFilenames[currentIdx + 1]); }}
                            aria-label="Next asset"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    )}

                    {/* Counter */}
                    {allFilenames.length > 1 && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-white/60 bg-black/40 rounded-full px-2 py-0.5">
                            {currentIdx + 1} / {allFilenames.length}
                        </div>
                    )}
                </div>

                {/* Right: metadata panel */}
                <div className="w-72 shrink-0 flex flex-col border-l border-border overflow-y-auto">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-border">
                        <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="text-[10px] shrink-0">{ext}</Badge>
                            {assetData?.size !== undefined && (
                                <span className="text-xs text-muted-foreground truncate">{formatSize(assetData.size)}</span>
                            )}
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
                        {/* Name */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Name</p>
                            {editingName ? (
                                <div className="flex gap-1">
                                    <Input
                                        value={assetName}
                                        onChange={(e) => setAssetName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveName();
                                            if (e.key === 'Escape') setEditingName(false);
                                        }}
                                        placeholder={fileDisplayName(filename)}
                                        className="h-7 text-xs flex-1"
                                        autoFocus
                                    />
                                    <button type="button" onClick={saveName}
                                        className="p-1 rounded hover:bg-muted text-muted-foreground">
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button type="button" onClick={() => setEditingName(false)}
                                        className="p-1 rounded hover:bg-muted text-muted-foreground">
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setEditingName(true)}
                                    className="group w-full flex items-center gap-1 text-left">
                                    <span className="text-sm font-medium flex-1 truncate">{displayName}</span>
                                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </button>
                            )}
                            <p className="text-[9px] text-muted-foreground font-mono mt-0.5 break-all">{filename}</p>
                        </div>

                        {/* Date */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Date</p>
                            {editingDate ? (
                                <div className="space-y-1">
                                    <SmartDateInput
                                        value={dateVal}
                                        onChange={(val) => setDateVal(val)}
                                        placeholder="e.g. Jun 1950"
                                        className="h-7 text-xs"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveDate();
                                            if (e.key === 'Escape') { setDateVal(assetData?.metadata.date ?? ''); setEditingDate(false); }
                                        }}
                                    />
                                    <div className="flex gap-1">
                                        <Button
                                            size="sm"
                                            className="h-6 text-xs px-2"
                                            onClick={saveDate}
                                            disabled={!!dateVal.trim() && !parseToISO(dateVal)}
                                        >
                                            Save
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2"
                                            onClick={() => { setDateVal(assetData?.metadata.date ?? ''); setEditingDate(false); }}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setEditingDate(true)}
                                    className="group w-full flex items-center gap-1 text-left">
                                    <span className="text-xs flex-1 truncate">
                                        {dateVal || <span className="text-muted-foreground italic">Add date…</span>}
                                    </span>
                                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </button>
                            )}
                        </div>

                        {/* Location */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Location</p>
                            {editingLocation ? (
                                <div className="space-y-1">
                                    <PlaceCombobox
                                        value={locationQuery}
                                        onChange={(q) => { setLocationQuery(q); setLocationPlace(null); }}
                                        onSelect={(p) => setLocationPlace(p)}
                                    />
                                    <div className="flex gap-1">
                                        <Button size="sm" className="h-6 text-xs px-2" onClick={saveLocation}>Save</Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2"
                                            onClick={() => {
                                                setLocationQuery(assetData?.metadata.location?.name ?? '');
                                                setLocationPlace(assetData?.metadata.location ?? null);
                                                setEditingLocation(false);
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setEditingLocation(true)}
                                    className="group w-full flex items-start gap-1 text-left">
                                    <MapPin className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0 opacity-60" />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-xs truncate block">
                                            {locationQuery || <span className="text-muted-foreground italic">Add location…</span>}
                                        </span>
                                        {locationPlace?.lat != null && (
                                            <span className="text-[9px] text-green-600 dark:text-green-400">
                                                {Math.abs(locationPlace.lat).toFixed(2)}°{locationPlace.lat >= 0 ? 'N' : 'S'},{' '}
                                                {Math.abs(locationPlace.lng ?? 0).toFixed(2)}°{(locationPlace.lng ?? 0) >= 0 ? 'E' : 'W'}
                                            </span>
                                        )}
                                    </div>
                                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                                </button>
                            )}
                        </div>

                        {/* Description */}
                        <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                            {editingDesc ? (
                                <div className="space-y-1">
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDescription(); }
                                            if (e.key === 'Escape') setEditingDesc(false);
                                        }}
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
                                <button type="button" onClick={() => setEditingDesc(true)}
                                    className="w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    {description || <span className="italic opacity-50">Add description…</span>}
                                </button>
                            )}
                        </div>

                        {/* People */}
                        {assetData && (
                            <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">People</p>
                                <div className="space-y-1 mb-2">
                                    {assetData.referencedBy.people.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic">No people linked</p>
                                    ) : (
                                        assetData.referencedBy.people.map((pid) => (
                                            <div key={pid} className="flex items-center gap-1.5">
                                                <PersonChip id={pid} className="flex-1 text-xs" />
                                                <button
                                                    type="button"
                                                    title="Remove link"
                                                    onClick={() => unlinkAsset.mutate(
                                                        { personId: pid, filename },
                                                        { onSuccess: () => toast.success('Person unlinked.'), onError: () => toast.error('Failed to unlink.') }
                                                    )}
                                                    className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <PersonSearchCombobox
                                    onSelect={(pid) => linkAsset.mutate(
                                        { personId: pid, filename },
                                        { onSuccess: () => toast.success('Person linked.'), onError: () => toast.error('Failed to link.') }
                                    )}
                                    excludeIds={assetData.referencedBy.people}
                                    placeholder="Link a person…"
                                    className="w-full"
                                />
                            </div>
                        )}

                        {/* Stories */}
                        {assetData && assetData.referencedBy.stories.length > 0 && (
                            <div>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Stories</p>
                                <div className="space-y-1">
                                    {assetData.referencedBy.stories.map((s) => (
                                        <Link key={s.id} to="/stories/$id" params={{ id: s.id }}
                                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                                            onClick={onClose}>
                                            <ExternalLink className="h-3 w-3 shrink-0" />
                                            {s.title}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer: delete */}
                    {onDeleteRequest && (
                        <div className="p-3 border-t border-border space-y-2">
                            {assetData?.isOrphan && (
                                <Badge variant="destructive" className="text-xs w-full justify-center">Unlinked — not attached to anyone</Badge>
                            )}
                            <Button
                                variant="destructive"
                                size="sm"
                                className="w-full h-7 text-xs"
                                onClick={() => { onDeleteRequest(filename); onClose(); }}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                {assetData?.isOrphan ? 'Delete file' : 'Delete file…'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
