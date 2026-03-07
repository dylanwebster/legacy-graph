import {
    useState, useEffect, useRef, useCallback,
} from 'react';
import { createLazyFileRoute, useNavigate, useSearch as useRouterSearch, Link, useBlocker } from '@tanstack/react-router';
import { useStory, useCreateStory, useUpdateStory, useUploadStoryMedia, usePlacesSearch } from '@/api/hooks';
import { storiesApi } from '@/api/stories';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
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
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
    const isEditModeRef = useRef(isEditMode);
    isEditModeRef.current = isEditMode;

    // When uploading images on a new (unsaved) story, or when auto-saving a new
    // story for the first time, we silently create it to get an ID.
    const silentlyCreatedIdRef = useRef<string | null>(null);
    // True only when user explicitly clicked Save/Create — prevents cleanup on unmount.
    const userExplicitlySavedRef = useRef(false);
    // Set to true immediately before any intentional navigate() call to suppress the
    // navigation blocker (e.g. after save, or after toolbar-initiated discard).
    const allowNavigationRef = useRef(false);
    // Snapshot of content+fm at the moment edit mode was entered (for Discard).
    const snapRef = useRef<{ content: string; fm: FrontmatterState } | null>(null);

    // Confirmation dialog for Discard / back-button navigation in edit mode
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
    // Incrementing this key forces the editor to remount after Discard resets content
    const [editorResetKey, setEditorResetKey] = useState(0);

    // Take a snapshot when first entering edit mode for an existing story.
    // The guard prevents re-snapshotting after auto-save updates the cache.
    useEffect(() => {
        if (!isEditMode || isNew || !story || snapRef.current) return;
        snapRef.current = {
            content: story.content ?? '',
            fm: {
                title: story.metadata.title ?? '',
                date: story.metadata.date ?? '',
                place: story.metadata.place ?? '',
                isPrivate: story.metadata.private ?? false,
            },
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditMode, isNew, story?.id]);

    // Clear snapshot when leaving edit mode (so the next edit session gets a fresh one)
    useEffect(() => {
        if (!isEditMode) snapRef.current = null;
    }, [isEditMode]);

    // ── Navigation guard ──────────────────────────────────────────────────────
    // Block all router navigation (sidebar, back, programmatic) when there are
    // unsaved edits. allowNavigationRef bypasses the guard for intentional saves/discards.

    const blocker = useBlocker({
        shouldBlockFn: useCallback(() => {
            if (allowNavigationRef.current) return false;
            return isEditMode && (isDirty || !!silentlyCreatedIdRef.current);
        }, [isEditMode, isDirty]),
        withResolver: true,
        enableBeforeUnload: true,
    });

    // Surface the existing discard dialog whenever the blocker intercepts navigation
    useEffect(() => {
        if (blocker.status === 'blocked') setShowDiscardConfirm(true);
    }, [blocker.status]);

    // On unmount: if a draft was auto-created but never explicitly saved, delete it + its assets.
    useEffect(() => {
        return () => {
            const draftId = silentlyCreatedIdRef.current;
            if (!draftId || userExplicitlySavedRef.current) return;
            // Fire-and-forget: purge uploaded assets then delete the draft story
            storiesApi.getStory(draftId)
                .then((s) => Promise.allSettled(
                    (s.metadata.assets ?? []).map((a) => storiesApi.deleteStoryMedia(draftId, a))
                ))
                .catch(() => {})
                .finally(() => storiesApi.deleteStory(draftId).catch(() => {}));
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const fmRef = useRef(fm);
    fmRef.current = fm;
    const contentRef2 = useRef(content);
    contentRef2.current = content;

    // Sync story data → local state on load
    // In edit mode, skip content/dirty reset so in-progress edits aren't clobbered
    // (e.g. after auto-save triggers a cache update)
    useEffect(() => {
        if (!story) return;
        setFm({
            title: story.metadata.title ?? '',
            date: story.metadata.date ?? '',
            place: story.metadata.place ?? '',
            isPrivate: story.metadata.private ?? false,
        });
        if (!isEditModeRef.current) {
            setContent(story.content ?? '');
            setIsDirty(false);
        }
    }, [story]);

    // Auto-save (3s debounce) while in edit mode — covers both new and existing stories.
    // New stories require a title before the first auto-save creates the draft.
    useEffect(() => {
        if (!isEditMode || !isDirty) return;
        if (isNew && !fm.title.trim()) return;
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(async () => {
            await doSave(false);
        }, 3000);
        return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, fm, isDirty]);

    const doSave = useCallback(async (navigateAfter = true) => {
        if (!fm.title.trim()) { toast.error('Title is required'); return; }
        if (fm.date && !parseToISO(fm.date)) {
            toast.error('Invalid date — try "15 Jun 1944" or "1944-06-15"');
            return;
        }
        setIsSaving(true);
        try {
            const mentionedPeople = extractMentionIds(content);
            const isoDate = parseToISO(fm.date) || undefined;
            const payload: UpdateStoryInput = {
                title: fm.title,
                content,
                date: isoDate,
                place: fm.place || undefined,
                people: mentionedPeople,
                private: fm.isPrivate,
            };
            if (isNew && silentlyCreatedIdRef.current) {
                const createdId = silentlyCreatedIdRef.current;
                await updateStory.mutateAsync({ id: createdId, data: payload });
                setIsDirty(false);
                if (navigateAfter) {
                    toast.success('Story created');
                    userExplicitlySavedRef.current = true;
                    allowNavigationRef.current = true;
                    navigate({ to: '/stories/$id', params: { id: createdId } });
                }
            } else if (isNew) {
                const created = await createStory.mutateAsync({ ...payload, title: fm.title });
                silentlyCreatedIdRef.current = created.id;
                setIsDirty(false);
                if (navigateAfter) {
                    toast.success('Story created');
                    userExplicitlySavedRef.current = true;
                    allowNavigationRef.current = true;
                    navigate({ to: '/stories/$id', params: { id: created.id } });
                }
            } else {
                await updateStory.mutateAsync({ id, data: payload });
                setIsDirty(false);
                if (navigateAfter) {
                    userExplicitlySavedRef.current = true;
                    allowNavigationRef.current = true;
                    navigate({ to: '/stories/$id', params: { id }, search: {} });
                }
            }
        } catch {
            toast.error('Failed to save story');
        } finally {
            setIsSaving(false);
        }
    }, [fm, content, isNew, id, createStory, updateStory, navigate]);

    // ── Discard ───────────────────────────────────────────────────────────────

    const handleDiscard = useCallback(async () => {
        setShowDiscardConfirm(false);
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

        // Was navigation blocked by the router, or was this triggered by the toolbar?
        // In the blocker case we call proceed() and the router takes the user to their
        // intended destination. In the toolbar case we navigate explicitly.
        const viaBlocker = blocker.status === 'blocked';

        if (isNew) {
            // Purge draft + its assets, then allow navigation
            const draftId = silentlyCreatedIdRef.current;
            if (draftId) {
                try {
                    const s = await storiesApi.getStory(draftId);
                    await Promise.allSettled(
                        (s.metadata.assets ?? []).map((a) => storiesApi.deleteStoryMedia(draftId, a))
                    );
                    await storiesApi.deleteStory(draftId);
                    silentlyCreatedIdRef.current = null;
                } catch { /* best-effort */ }
            }
            if (viaBlocker) {
                blocker.proceed?.();
            } else {
                allowNavigationRef.current = true;
                navigate({ to: '/stories' });
            }
        } else {
            // Revert server to the snapshot captured when entering edit mode
            const snap = snapRef.current;
            if (snap) {
                setIsSaving(true);
                try {
                    await updateStory.mutateAsync({
                        id,
                        data: {
                            title: snap.fm.title,
                            content: snap.content,
                            date: parseToISO(snap.fm.date) || undefined,
                            place: snap.fm.place || undefined,
                            people: extractMentionIds(snap.content),
                            private: snap.fm.isPrivate,
                        },
                    });
                } catch { /* ignore */ } finally {
                    setIsSaving(false);
                }
                setContent(snap.content);
                setFm(snap.fm);
            }
            setIsDirty(false);
            setEditorResetKey((k) => k + 1);
            snapRef.current = null;
            if (viaBlocker) {
                blocker.proceed?.();
            } else {
                allowNavigationRef.current = true;
                navigate({ to: '/stories/$id', params: { id }, search: {} });
            }
        }
    }, [isNew, id, updateStory, navigate, blocker]);

    // ── Image upload handler ──────────────────────────────────────────────────

    const handleImageUpload = useCallback(async (file: File): Promise<string> => {
        let targetId: string;

        if (isNew) {
            // Re-use a silently-created story if one already exists from a prior upload
            if (silentlyCreatedIdRef.current) {
                targetId = silentlyCreatedIdRef.current;
            } else {
                const currentFm = fmRef.current;
                if (!currentFm.title.trim()) {
                    toast.error('Add a title before uploading images');
                    throw new Error('No title');
                }
                // Auto-create the story so we have an ID to attach media to
                const isoDate = parseToISO(currentFm.date) || undefined;
                const created = await createStory.mutateAsync({
                    title: currentFm.title,
                    content: contentRef2.current,
                    date: isoDate,
                    place: currentFm.place || undefined,
                    people: extractMentionIds(contentRef2.current),
                    private: currentFm.isPrivate,
                });
                silentlyCreatedIdRef.current = created.id;
                targetId = created.id;
                toast.info('Uploading image — click Create to keep this story');
            }
        } else {
            targetId = id;
        }

        const updated = await uploadMedia.mutateAsync({ id: targetId, file });
        const asset = updated.metadata.assets[updated.metadata.assets.length - 1];
        return asset;
    }, [id, isNew, createStory, uploadMedia]);

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
                <Link to="/stories" className="hover:text-foreground transition-colors">
                    Stories
                </Link>
                <span>/</span>
                <span className="text-foreground font-medium truncate max-w-[260px]">
                    {fm.title || (isNew ? 'New Story' : story?.metadata.title)}
                </span>
            </nav>

            <div className="ml-auto flex items-center gap-2">
                {isEditMode && (
                    <span className="text-xs text-muted-foreground italic">
                        {isSaving ? 'Saving…' : isDirty ? 'Unsaved' : 'Saved'}
                    </span>
                )}
                {isEditMode ? (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-muted-foreground"
                            onClick={() => setShowDiscardConfirm(true)}
                            disabled={isSaving}
                        >
                            Discard
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => doSave(true)}
                            disabled={isSaving || (isNew && !fm.title.trim())}
                        >
                            <Save className="h-3.5 w-3.5 mr-1.5" />
                            {isNew ? 'Create' : 'Save'}
                        </Button>
                    </>
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
        <div className="mt-8">
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
                    {/* Title — same visual styles in both modes */}
                    {isEditMode ? (
                        <input
                            type="text"
                            placeholder="Story title…"
                            value={fm.title}
                            onChange={(e) => { setFm((p) => ({ ...p, title: e.target.value })); setIsDirty(true); }}
                            className="w-full mb-3 bg-transparent border-none outline-none text-3xl font-bold text-foreground placeholder:text-muted-foreground/50"
                            style={{ fontFamily: 'Merriweather, Georgia, serif', lineHeight: '1.3', fontSize: '1.875rem' }}
                        />
                    ) : (
                        <h1
                            className="font-serif text-3xl font-bold mb-3"
                            style={{ fontFamily: 'Merriweather, Georgia, serif', lineHeight: '1.3' }}
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
                                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
                                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors ${
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
                            <>
                                {!!fm.date && (
                                    <span className="h-7 flex items-center gap-1 text-sm text-muted-foreground">
                                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                        {fm.date}
                                    </span>
                                )}
                                {!!fm.place && (
                                    <span className="h-7 flex items-center gap-1 text-sm text-muted-foreground">
                                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                                        {fm.place}
                                    </span>
                                )}
                                {!!fm.isPrivate && (
                                    <span className="h-7 flex items-center">
                                        <Badge variant="secondary" className="text-xs">
                                            <Lock className="h-3 w-3 mr-1" />
                                            Private
                                        </Badge>
                                    </span>
                                )}
                            </>
                        )}
                    </div>

                    {/* People chips — always shown */}
                    {mentionedPeople.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                            {mentionedPeople.map((pid) => (
                                <PersonChip key={pid} id={pid} />
                            ))}
                        </div>
                    )}

                    {/* Body — bordered section marks where prose begins and ends */}
                    <div className="border-t border-b border-border py-6">
                        {(isEditMode || content) && (
                            <MilkdownEditor
                                key={`editor-${id}-${story ? 'loaded' : 'unloaded'}-${editorResetKey}`}
                                content={content}
                                onChange={(md) => { setContent(md); setIsDirty(true); }}
                                onImageUpload={handleImageUpload}
                                enableMentions={true}
                                readOnly={!isEditMode}
                                onMentionClick={!isEditMode ? handleMentionClick : undefined}
                            />
                        )}

                        {/* Tip — below editor, inside content boundary */}
                        {isEditMode && (
                            <p className="text-[10px] text-muted-foreground/50 mt-3">
                                Tip: type <kbd className="font-mono bg-muted px-0.5 rounded">@</kbd> in the body to mention a person — they'll be linked automatically.
                            </p>
                        )}
                    </div>

                    {filmstrip}
                </div>
            </div>

            {/* Discard confirmation */}
            <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Discard changes?</DialogTitle>
                        <DialogDescription>
                            {isNew
                                ? 'This story will not be saved and any uploaded images will be deleted.'
                                : 'Your unsaved changes will be reverted to the last saved version.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => {
                            if (blocker.status === 'blocked') blocker.reset?.();
                            setShowDiscardConfirm(false);
                        }}>
                            Keep editing
                        </Button>
                        <Button variant="destructive" onClick={handleDiscard} disabled={isSaving}>
                            Discard
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
