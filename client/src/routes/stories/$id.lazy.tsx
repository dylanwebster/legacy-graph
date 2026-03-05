import {
    useState, useEffect, useRef, useCallback, useDeferredValue,
} from 'react';
import { createLazyFileRoute, useNavigate, useSearch as useRouterSearch } from '@tanstack/react-router';
import { useStory, useCreateStory, useUpdateStory, useUploadStoryMedia } from '@/api/hooks';
import { useSearch } from '@/api/hooks';
import { PersonChip } from '@/components/PersonChip';
import { TiptapEditor } from '@/components/TiptapEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Pencil, Eye, Save, ArrowLeft, MapPin, CalendarDays,
    Upload, X, Lock, Unlock, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SlimPersonSummary } from '@/api/people';
import type { UpdateStoryInput } from '@/api/stories';

export const Route = createLazyFileRoute('/stories/$id')({
    component: StoryPage,
});

// ── Types ───────────────────────────────────────────────────────────────────

interface FrontmatterState {
    title: string;
    date: string;
    place: string;
    people: string[];
    isPrivate: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Custom ReactMarkdown text renderer that converts @N_xxx → PersonChip
function MarkdownPersonMentions({ children }: { children: string }) {
    const parts = children.split(/(@N_[a-zA-Z0-9_-]+|\[\[N_[a-zA-Z0-9_-]+\]\])/g);
    return (
        <>
            {parts.map((part, i) => {
                const atMatch = part.match(/^@(N_[a-zA-Z0-9_-]+)$/);
                const wikiMatch = part.match(/^\[\[(N_[a-zA-Z0-9_-]+)\]\]$/);
                const id = atMatch?.[1] ?? wikiMatch?.[1];
                if (id) return <PersonChip key={i} id={id} />;
                return <span key={i}>{part}</span>;
            })}
        </>
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
        people: [],
        isPrivate: false,
    });

    // Editor content (raw Markdown)
    const [content, setContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    // People search for frontmatter "Tagged People"
    const [peopleQuery, setPeopleQuery] = useState('');
    const deferredPeopleQuery = useDeferredValue(peopleQuery);

    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Search for frontmatter people picker
    const { data: peopleSearchData } = useSearch(deferredPeopleQuery, { limit: 8 });
    const peopleResults: SlimPersonSummary[] = (peopleSearchData as any)?.people ?? [];

    // Sync story data → local state on load
    useEffect(() => {
        if (!story) return;
        setFm({
            title: story.metadata.title ?? '',
            date: story.metadata.date ?? '',
            place: story.metadata.place ?? '',
            people: story.metadata.people ?? [],
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
            const payload: UpdateStoryInput = {
                title: fm.title,
                content,
                date: fm.date || undefined,
                place: fm.place || undefined,
                people: fm.people,
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
                    navigate({
                        to: '/stories/$id',
                        params: { id },
                        search: {},
                    });
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

    // ── Drag & drop media (wrapper div) ──────────────────────────────────────

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (isNew) { toast.error('Save the story first before uploading media'); return; }
        const file = e.dataTransfer.files[0];
        if (!file) return;
        try {
            const asset = await handleImageUpload(file);
            const mdImg = `\n![${file.name}](/assets/${asset})\n`;
            setContent((prev) => prev + mdImg);
            setIsDirty(true);
            toast.success('Asset uploaded and inserted');
        } catch { toast.error('Failed to upload asset'); }
    }, [isNew, handleImageUpload]);

    // ── People tag management ────────────────────────────────────────────────

    const addPersonToFm = (person: SlimPersonSummary) => {
        if (fm.people.includes(person.id)) return;
        setFm((prev) => ({ ...prev, people: [...prev.people, person.id] }));
        setIsDirty(true);
        setPeopleQuery('');
    };

    const removePersonFromFm = (pid: string) => {
        setFm((prev) => ({ ...prev, people: prev.people.filter((p) => p !== pid) }));
        setIsDirty(true);
    };

    // ── Lightbox for filmstrip ────────────────────────────────────────────────

    const [lightbox, setLightbox] = useState<string | null>(null);

    useEffect(() => {
        if (!lightbox) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [lightbox]);

    // ── Loading / error ───────────────────────────────────────────────────────

    if (!isNew && isLoading) {
        return (
            <div className="p-8 space-y-4 max-w-3xl mx-auto">
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

    // ── Shared header ─────────────────────────────────────────────────────────

    const header = (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 bg-card">
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate({ to: '/stories' })}
            >
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
                Stories /
                <span className="text-foreground ml-1 font-medium">
                    {fm.title || (isNew ? 'New Story' : story?.metadata.title)}
                </span>
            </span>

            <div className="ml-auto flex items-center gap-2">
                {isDirty && !isNew && (
                    <span className="text-xs text-muted-foreground italic">{isSaving ? 'Saving…' : 'Unsaved'}</span>
                )}
                {isEditMode ? (
                    <>
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
                        {!isNew && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8"
                                onClick={() => navigate({ to: '/stories/$id', params: { id }, search: {} })}
                            >
                                <Eye className="h-3.5 w-3.5 mr-1.5" />
                                Preview
                            </Button>
                        )}
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

    // ── Reader mode ───────────────────────────────────────────────────────────

    if (!isEditMode && story) {
        return (
            <div className="flex flex-col h-full overflow-hidden">
                {header}
                <div className="flex-1 overflow-y-auto">
                    <article className="max-w-[720px] mx-auto px-6 py-8">
                        {/* Title */}
                        <h1 className="font-serif text-3xl font-bold leading-tight mb-3" style={{ fontFamily: 'Merriweather, Georgia, serif' }}>
                            {story.metadata.title}
                        </h1>

                        {/* Meta */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-sm text-muted-foreground">
                            {story.metadata.date && (
                                <span className="flex items-center gap-1">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {story.metadata.date}
                                </span>
                            )}
                            {story.metadata.place && (
                                <span className="flex items-center gap-1">
                                    <MapPin className="h-3.5 w-3.5" />
                                    {story.metadata.place}
                                </span>
                            )}
                            {story.metadata.private && (
                                <Badge variant="secondary" className="text-xs">
                                    <Lock className="h-3 w-3 mr-1" />
                                    Private
                                </Badge>
                            )}
                        </div>

                        {/* Tagged people */}
                        {story.metadata.people.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mb-6 pb-4 border-b border-border">
                                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                {story.metadata.people.map((pid) => (
                                    <PersonChip key={pid} id={pid} />
                                ))}
                            </div>
                        )}

                        {/* Body */}
                        <div
                            className="prose prose-sm dark:prose-invert max-w-none"
                            style={{ fontFamily: 'Merriweather, Georgia, serif' }}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    p: ({ children }) => (
                                        <p>
                                            {typeof children === 'string'
                                                ? <MarkdownPersonMentions>{children}</MarkdownPersonMentions>
                                                : children}
                                        </p>
                                    ),
                                    text: ({ children }) => {
                                        if (typeof children === 'string') {
                                            return <MarkdownPersonMentions>{children}</MarkdownPersonMentions>;
                                        }
                                        return <>{children}</>;
                                    },
                                }}
                            >
                                {story.content}
                            </ReactMarkdown>
                        </div>

                        {/* Filmstrip */}
                        {assets.length > 0 && (
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
                        )}
                    </article>
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

    // ── Editor mode ───────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {header}

            {/* Frontmatter fields */}
            <div className="border-b border-border bg-muted/30 px-4 py-3 shrink-0 space-y-2">
                {/* Title */}
                <Input
                    placeholder="Story title…"
                    value={fm.title}
                    onChange={(e) => { setFm((p) => ({ ...p, title: e.target.value })); setIsDirty(true); }}
                    className="text-lg font-semibold h-9 border-0 bg-transparent shadow-none px-0 focus-visible:ring-0 placeholder:text-muted-foreground/60"
                />

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Date */}
                    <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Input
                            placeholder="Date range (e.g. 1939–1945)"
                            value={fm.date}
                            onChange={(e) => { setFm((p) => ({ ...p, date: e.target.value })); setIsDirty(true); }}
                            className="h-7 text-sm w-48 border-muted"
                        />
                    </div>

                    {/* Place */}
                    <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Input
                            placeholder="Place"
                            value={fm.place}
                            onChange={(e) => { setFm((p) => ({ ...p, place: e.target.value })); setIsDirty(true); }}
                            className="h-7 text-sm w-40 border-muted"
                        />
                    </div>

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
                </div>

                {/* Tagged people */}
                <div className="flex flex-wrap items-center gap-1.5 relative">
                    <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {fm.people.map((pid) => (
                        <span key={pid} className="flex items-center gap-0.5">
                            <PersonChip id={pid} />
                            <button
                                onClick={() => removePersonFromFm(pid)}
                                className="text-muted-foreground hover:text-destructive ml-0.5"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                    <div className="relative">
                        <Input
                            placeholder="Tag person…"
                            value={peopleQuery}
                            onChange={(e) => setPeopleQuery(e.target.value)}
                            className="h-6 text-xs w-28 border-muted"
                        />
                        {deferredPeopleQuery.length >= 2 && peopleResults.length > 0 && (
                            <div className="absolute top-full mt-1 left-0 z-50 bg-popover border border-border rounded-md shadow-md w-52 max-h-48 overflow-y-auto">
                                {peopleResults.map((person) => {
                                    const n = person.names?.[0];
                                    const label = [n?.first, n?.last].filter(Boolean).join(' ') || person.id;
                                    return (
                                        <button
                                            key={person.id}
                                            onMouseDown={(e) => { e.preventDefault(); addPersonToFm(person); }}
                                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Tiptap rich editor */}
            <div
                className="flex-1 overflow-auto relative"
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
            >
                {isDragOver && (
                    <div className="absolute inset-0 z-10 bg-primary/10 border-2 border-dashed border-primary rounded flex items-center justify-center pointer-events-none">
                        <div className="flex flex-col items-center gap-2 text-primary">
                            <Upload className="h-8 w-8" />
                            <span className="text-sm font-medium">Drop to upload</span>
                        </div>
                    </div>
                )}
                <TiptapEditor
                    content={content}
                    onChange={(md) => { setContent(md); setIsDirty(true); }}
                    placeholder={`Write your story here…\n\nType @ to mention a person`}
                    onImageUpload={handleImageUpload}
                    className="h-full"
                    minHeight="300px"
                />
            </div>
        </div>
    );
}
