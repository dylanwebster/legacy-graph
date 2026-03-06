import {
    useState, useEffect, useRef, useCallback,
} from 'react';
import { createLazyFileRoute, useNavigate, useSearch as useRouterSearch, Link } from '@tanstack/react-router';
import { useStory, useCreateStory, useUpdateStory, useUploadStoryMedia, usePlacesSearch } from '@/api/hooks';
import { PersonChip } from '@/components/PersonChip';
import { MilkdownEditor } from '@/components/MilkdownEditor';
import { SmartDateInput, parseToISO } from '@/components/SmartDateInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Pencil, Save, ArrowLeft, MapPin, CalendarDays,
    X, Lock, Unlock, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Place } from '@/api/people';
import type { UpdateStoryInput } from '@/api/stories';

export const Route = createLazyFileRoute('/stories/$id')({
    component: StoryPage,
});

// ── Types ───────────────────────────────────────────────────────────────────

interface FrontmatterState {
    title: string;
    date: string;
    place: string;
    isPrivate: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract person IDs from @N_xxx and [[N_xxx]] patterns in markdown content. */
function extractMentionIds(content: string): string[] {
    const ids = new Set<string>();
    const regex = /(?:@|(?:\[\[))(N_[a-zA-Z0-9_-]+)(?:\]\])?/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
        ids.add(m[1]);
    }
    return Array.from(ids);
}

// ── PlaceSearchCombobox ──────────────────────────────────────────────────────

function PlaceSearchCombobox({
    value,
    onChange,
}: {
    value: string;
    onChange: (name: string) => void;
}) {
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(value), 200);
        return () => clearTimeout(t);
    }, [value]);

    const { data: places, isFetching } = usePlacesSearch(debouncedQuery);

    const handleSelect = (place: Place) => {
        onChange(place.name);
        setSelectedPlace(place);
        setShowDropdown(false);
    };

    const handleChange = (query: string) => {
        onChange(query);
        setSelectedPlace(null);
        setShowDropdown(true);
    };

    const displayLat = selectedPlace?.lat != null
        ? `${Math.abs(selectedPlace.lat).toFixed(2)}°${selectedPlace.lat >= 0 ? 'N' : 'S'}, ${Math.abs(selectedPlace.lng ?? 0).toFixed(2)}°${(selectedPlace.lng ?? 0) >= 0 ? 'E' : 'W'}`
        : null;

    const isSearching = isFetching && debouncedQuery.length >= 2;

    return (
        <div>
            <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1.5" />
                <div className="relative">
                    <Input
                        placeholder="Place (city, country…)"
                        value={value}
                        onChange={(e) => handleChange(e.target.value)}
                        onFocus={() => setShowDropdown(true)}
                        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                        className="h-7 text-sm w-56 border-muted pr-7"
                    />
                    {isSearching && (
                        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                    {showDropdown && debouncedQuery.length >= 2 && (places ?? []).length > 0 && (
                        <div className="absolute z-50 w-64 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                            {(places ?? []).map((place, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 text-left"
                                    onMouseDown={() => handleSelect(place)}
                                >
                                    <span className="truncate flex-1">{place.name}</span>
                                    {!!place.countryCode && (
                                        <span className="text-muted-foreground shrink-0">{place.countryCode}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {!!displayLat && (
                <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5 ml-5">{displayLat}</p>
            )}
        </div>
    );
}

// ── Main page ────────────────────────────────────────────────────────────────

function StoryPage() {
    const { id } = Route.useParams();
    const routerSearch = useRouterSearch({ strict: false }) as { mode?: string };
    const navigate = useNavigate();

    const isNew = id === 'new';
    const isEditMode = isNew || routerSearch.mode === 'edit';

    const { data: story, isLoading, isError } = useStory(id);
    const createStory = useCreateStory();
    const updateStory = useUpdateStory();
    const uploadMedia = useUploadStoryMedia();

    // Frontmatter state
    const [fm, setFm] = useState<FrontmatterState>({
        title: '',
        date: '',
        place: '',
        isPrivate: false,
    });

    // Editor content (raw Markdown)
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync story data → local state on load
    useEffect(() => {
        if (!story) return;
        setFm({
            title: story.metadata.title ?? '',
            date: story.metadata.date ?? '',
            place: story.metadata.place ?? '',
            isPrivate: story.metadata.private ?? false,
        });
        setContent(story.content ?? '');
        setIsDirty(false);
    }, [story]);

    // Auto-save (3s debounce) while in edit mode
    useEffect(() => {
        if (!isEditMode || isNew || !isDirty) return;
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(async () => {
            await doSave(false);
        }, 3000);
        return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, fm, isDirty]);

    const doSave = useCallback(async (navigateAfter = true) => {
        if (!fm.title.trim()) { toast.error('Title is required'); return; }
        setIsSaving(true);
        try {
            const mentionedPeople = extractMentionIds(content);
            const isoDate = parseToISO(fm.date) ?? (fm.date || undefined);
            const payload: UpdateStoryInput = {
                title: fm.title,
                content,
                date: isoDate,
                place: fm.place || undefined,
                people: mentionedPeople,
                private: fm.isPrivate,
            };
            if (isNew) {
                const created = await createStory.mutateAsync({ ...payload, title: fm.title });
                toast.success('Story created');
                if (navigateAfter) {
                    navigate({ to: '/stories/$id', params: { id: created.id } });
                }
            } else {
                await updateStory.mutateAsync({ id, data: payload });
                setIsDirty(false);
                if (navigateAfter) {
                    navigate({ to: '/stories/$id', params: { id }, search: {} });
                }
            }
        } catch {
            toast.error('Failed to save story');
        } finally {
            setIsSaving(false);
        }
    }, [fm, content, isNew, id, createStory, updateStory, navigate]);

    // ── Image upload handler ──────────────────────────────────────────────────

    const handleImageUpload = useCallback(async (file: File): Promise<string> => {
        if (isNew) {
            toast.error('Save the story first before uploading media');
            throw new Error('Save story first');
        }
        const updated = await uploadMedia.mutateAsync({ id, file });
        const asset = updated.metadata.assets[updated.metadata.assets.length - 1];
        return asset;
    }, [id, isNew, uploadMedia]);

    // ── Lightbox for filmstrip ────────────────────────────────────────────────

    const [lightbox, setLightbox] = useState<string | null>(null);

    useEffect(() => {
        if (!lightbox) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [lightbox]);

    // ── Mention click handler ─────────────────────────────────────────────────

    const handleMentionClick = useCallback((personId: string) => {
        navigate({ to: '/people/$id', params: { id: personId } });
    }, [navigate]);

    // ── Loading / error ───────────────────────────────────────────────────────

    if (!isNew && isLoading) {
        return (
            <div className="p-8 space-y-4 max-w-[720px] mx-auto">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (!isNew && (isError || !story)) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Story not found.{' '}
                <Button variant="link" onClick={() => navigate({ to: '/stories' })}>
                    Back to Stories
                </Button>
            </div>
        );
    }

    const assets = story?.metadata.assets ?? [];
    const mentionedPeople = Array.from(new Set([
        ...(story?.metadata.people ?? []),
        ...(story?.mentions ?? []),
    ]));

    // ── Shared header ─────────────────────────────────────────────────────────

    const header = (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 bg-card">
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate({ to: '/stories' })}
                aria-label="Back to Stories"
            >
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <nav className="text-sm text-muted-foreground flex items-center gap-1">
                <Link
                    to="/stories"
                    className="hover:text-foreground transition-colors"
                >
                    Stories
                </Link>
                <span>/</span>
                <span className="text-foreground font-medium truncate max-w-[260px]">
                    {fm.title || (isNew ? 'New Story' : story?.metadata.title)}
                </span>
            </nav>

            <div className="ml-auto flex items-center gap-2">
                {isDirty && !isNew && (
                    <span className="text-xs text-muted-foreground italic">{isSaving ? 'Saving…' : 'Unsaved'}</span>
                )}
                {isEditMode ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => doSave(true)}
                        disabled={isSaving}
                    >
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        {isNew ? 'Create' : 'Save'}
                    </Button>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => navigate({ to: '/stories/$id', params: { id }, search: { mode: 'edit' } })}
                    >
                        <Pencil className="h-3.5 w-3.5 mr-1.5" />
                        Edit Story
                    </Button>
                )}
            </div>
        </div>
    );

    // ── Filmstrip ─────────────────────────────────────────────────────────────

    const filmstrip = assets.length > 0 ? (
        <div className="mt-10 pt-6 border-t border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Photos & Attachments
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
                {assets.map((asset) => (
                    <button
                        key={asset}
                        onClick={() => setLightbox(asset)}
                        className="shrink-0 w-24 h-24 rounded-md overflow-hidden border border-border hover:border-primary/50 transition-colors"
                    >
                        <img
                            src={`/assets/${asset}`}
                            alt={asset}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </button>
                ))}
            </div>
        </div>
    ) : null;

    // ── Unified render (view + edit) ──────────────────────────────────────────

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {header}

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[720px] mx-auto px-6 py-8">
                    {/* Title */}
                    {isEditMode ? (
                        <Input
                            placeholder="Story title…"
                            value={fm.title}
                            onChange={(e) => { setFm((p) => ({ ...p, title: e.target.value })); setIsDirty(true); }}
                            className="text-3xl font-bold font-serif h-auto border-0 bg-transparent shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50 mb-3"
                            style={{ fontFamily: 'Merriweather, Georgia, serif', lineHeight: '1.3' }}
                        />
                    ) : (
                        <h1
                            className="font-serif text-3xl font-bold leading-tight mb-3"
                            style={{ fontFamily: 'Merriweather, Georgia, serif' }}
                        >
                            {fm.title || story?.metadata.title}
                        </h1>
                    )}

                    {/* Meta row */}
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 mb-4">
                        {isEditMode ? (
                            <>
                                {/* Date */}
                                <div className="flex items-center gap-1.5">
                                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1.5" />
                                    <SmartDateInput
                                        value={fm.date}
                                        onChange={(display) => { setFm((p) => ({ ...p, date: display })); setIsDirty(true); }}
                                        placeholder="Date (e.g. 15 Jun 1944)"
                                        className="h-7 text-sm w-52 border-muted"
                                    />
                                </div>

                                {/* Place */}
                                <PlaceSearchCombobox
                                    value={fm.place}
                                    onChange={(name) => { setFm((p) => ({ ...p, place: name })); setIsDirty(true); }}
                                />

                                {/* Private toggle */}
                                <button
                                    onClick={() => { setFm((p) => ({ ...p, isPrivate: !p.isPrivate })); setIsDirty(true); }}
                                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors mt-0.5 ${
                                        fm.isPrivate
                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                            : 'text-muted-foreground hover:bg-muted'
                                    }`}
                                >
                                    {fm.isPrivate ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                                    {fm.isPrivate ? 'Private' : 'Public'}
                                </button>
                            </>
                        ) : (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                {!!fm.date && (
                                    <span className="flex items-center gap-1">
                                        <CalendarDays className="h-3.5 w-3.5" />
                                        {fm.date}
                                    </span>
                                )}
                                {!!fm.place && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="h-3.5 w-3.5" />
                                        {fm.place}
                                    </span>
                                )}
                                {!!fm.isPrivate && (
                                    <Badge variant="secondary" className="text-xs">
                                        <Lock className="h-3 w-3 mr-1" />
                                        Private
                                    </Badge>
                                )}
                            </div>
                        )}
                    </div>

                    {/* People chips — always shown */}
                    {mentionedPeople.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-6 pb-4 border-b border-border">
                            {mentionedPeople.map((pid) => (
                                <PersonChip key={pid} id={pid} />
                            ))}
                        </div>
                    )}

                    {/* Tip — edit mode only */}
                    {isEditMode && (
                        <p className="text-[10px] text-muted-foreground/60 mb-4">
                            Tip: type <kbd className="font-mono bg-muted px-0.5 rounded">@</kbd> in the body to mention a person — they'll be linked automatically.
                        </p>
                    )}

                    {/* Body — always Crepe, readOnly toggled */}
                    {(isNew || content) && (
                        <MilkdownEditor
                            key={`editor-${id}-${story ? 'loaded' : 'unloaded'}`}
                            content={content}
                            onChange={(md) => { setContent(md); setIsDirty(true); }}
                            onImageUpload={handleImageUpload}
                            enableMentions={true}
                            readOnly={!isEditMode}
                            onMentionClick={!isEditMode ? handleMentionClick : undefined}
                        />
                    )}

                    {filmstrip}
                </div>
            </div>

            {/* Lightbox */}
            {lightbox && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
                    onClick={() => setLightbox(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white/80 hover:text-white"
                        onClick={() => setLightbox(null)}
                    >
                        <X className="h-6 w-6" />
                    </button>
                    <img
                        src={`/assets/${lightbox}`}
                        alt={lightbox}
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
