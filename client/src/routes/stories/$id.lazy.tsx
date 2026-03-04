import {
    useState, useEffect, useRef, useCallback, useDeferredValue,
} from 'react';
import { createLazyFileRoute, useNavigate, useSearch as useRouterSearch } from '@tanstack/react-router';
import { useStory, useCreateStory, useUpdateStory, useUploadStoryMedia } from '@/api/hooks';
import { useSearch } from '@/api/hooks';
import { PersonChip } from '@/components/PersonChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '@/components/ui/resizable';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Pencil, Eye, Save, ArrowLeft, MapPin, CalendarDays,
    Upload, X, Lock, Unlock, Image as ImageIcon, Users,
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

interface MentionPopover {
    open: boolean;
    query: string;
    /** Character index in textarea where the `@` was typed */
    triggerIndex: number;
}

interface SlashMenu {
    open: boolean;
    /** Character index in textarea where `/` was typed */
    triggerIndex: number;
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

    // @mention popover
    const [mention, setMention] = useState<MentionPopover>({ open: false, query: '', triggerIndex: -1 });
    const deferredMentionQuery = useDeferredValue(mention.query);

    // /slash menu
    const [slashMenu, setSlashMenu] = useState<SlashMenu>({ open: false, triggerIndex: -1 });

    // People search for frontmatter "Tagged People"
    const [peopleQuery, setPeopleQuery] = useState('');
    const deferredPeopleQuery = useDeferredValue(peopleQuery);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const mentionListRef = useRef<HTMLDivElement>(null);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Search for @mention type-ahead
    const { data: mentionSearchData } = useSearch(deferredMentionQuery, { limit: 8 });
    const mentionResults: SlimPersonSummary[] = (mentionSearchData as any)?.people ?? [];

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

    // ── Textarea @mention + /slash handling ─────────────────────────────────

    const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setContent(value);
        setIsDirty(true);

        const cursor = e.target.selectionStart ?? 0;
        const textBefore = value.slice(0, cursor);

        // Detect active @mention
        const atMatch = textBefore.match(/@([a-zA-Z0-9_-]*)$/);
        if (atMatch) {
            setMention({ open: true, query: atMatch[1], triggerIndex: cursor - atMatch[0].length });
            setSlashMenu({ open: false, triggerIndex: -1 });
            return;
        }
        setMention({ open: false, query: '', triggerIndex: -1 });

        // Detect /command at start of word
        const slashMatch = textBefore.match(/(?:^|\n)(\/[a-z]*)$/);
        if (slashMatch) {
            setSlashMenu({ open: true, triggerIndex: cursor - slashMatch[1].length });
            return;
        }
        setSlashMenu({ open: false, triggerIndex: -1 });
    }, []);

    const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (mention.open || slashMenu.open) {
            if (e.key === 'Escape') {
                setMention({ open: false, query: '', triggerIndex: -1 });
                setSlashMenu({ open: false, triggerIndex: -1 });
                e.preventDefault();
            }
        }
    }, [mention.open, slashMenu.open]);

    const insertMention = useCallback((person: SlimPersonSummary) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const before = content.slice(0, mention.triggerIndex);
        const after = content.slice(ta.selectionStart);
        const newContent = `${before}@${person.id}${after}`;
        setContent(newContent);
        setIsDirty(true);
        setMention({ open: false, query: '', triggerIndex: -1 });
        // Restore focus + move cursor after the inserted mention
        requestAnimationFrame(() => {
            ta.focus();
            const pos = before.length + person.id.length + 1;
            ta.setSelectionRange(pos, pos);
        });
    }, [content, mention.triggerIndex]);

    const insertSlashCommand = useCallback((cmd: 'image' | 'person') => {
        const ta = textareaRef.current;
        if (!ta) return;
        const before = content.slice(0, slashMenu.triggerIndex);
        const after = content.slice(ta.selectionStart);
        if (cmd === 'image') {
            // Trigger file input
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file || isNew) return;
                try {
                    const updated = await uploadMedia.mutateAsync({ id, file });
                    const asset = updated.metadata.assets[updated.metadata.assets.length - 1];
                    const mdImg = `![${file.name}](../assets/${asset})`;
                    const newContent = `${before}${mdImg}${after}`;
                    setContent(newContent);
                    setIsDirty(true);
                } catch { toast.error('Failed to upload image'); }
            };
            input.click();
        } else {
            // /person → switch to @mention mode by inserting @
            const newContent = `${before}@${after}`;
            setContent(newContent);
            setMention({ open: true, query: '', triggerIndex: slashMenu.triggerIndex });
        }
        setSlashMenu({ open: false, triggerIndex: -1 });
    }, [content, slashMenu.triggerIndex, id, isNew, uploadMedia]);

    // ── Drag & drop media ────────────────────────────────────────────────────

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        if (isNew) { toast.error('Save the story first before uploading media'); return; }
        const file = e.dataTransfer.files[0];
        if (!file) return;
        try {
            const updated = await uploadMedia.mutateAsync({ id, file });
            const asset = updated.metadata.assets[updated.metadata.assets.length - 1];
            const mdImg = `\n![${file.name}](../assets/${asset})\n`;
            setContent((prev) => prev + mdImg);
            setIsDirty(true);
            toast.success('Asset uploaded and inserted');
        } catch { toast.error('Failed to upload asset'); }
    }, [id, isNew, uploadMedia]);

    // ── People tag management ────────────────────────────────────────────────

    const addPersonToFm = (person: SlimPersonSummary) => {
        if (fm.people.includes(person.id)) return;
        setFm((prev) => ({ ...prev, people: [...prev.people, person.id] }));
        setIsDirty(true);
        setPeopleQuery('');
    };

    const removePersonFromFm = (id: string) => {
        setFm((prev) => ({ ...prev, people: prev.people.filter((p) => p !== id) }));
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

    // Inline preview — renders @mentions as PersonChips
    const PreviewContent = () => (
        <div
            className="prose prose-sm dark:prose-invert max-w-none p-4 h-full overflow-y-auto"
            style={{ fontFamily: 'Merriweather, Georgia, serif' }}
        >
            {content ? (
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        text: ({ children }) => {
                            if (typeof children === 'string') {
                                return <MarkdownPersonMentions>{children}</MarkdownPersonMentions>;
                            }
                            return <>{children}</>;
                        },
                    }}
                >
                    {content}
                </ReactMarkdown>
            ) : (
                <p className="text-muted-foreground italic text-sm">Preview will appear here…</p>
            )}
        </div>
    );

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

            {/* Split pane editor + preview */}
            <div className="flex-1 overflow-hidden relative">
                <ResizablePanelGroup orientation="horizontal" className="h-full">
                    {/* Left: Markdown textarea */}
                    <ResizablePanel defaultSize={50} minSize={25}>
                        <div
                            className="h-full relative"
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
                            <textarea
                                ref={textareaRef}
                                value={content}
                                onChange={handleTextareaChange}
                                onKeyDown={handleTextareaKeyDown}
                                placeholder={`Write your story here…\n\nType @ to mention a person — e.g. @N_bach-1685\nType / for slash commands: /image to insert a photo`}
                                className="w-full h-full resize-none bg-background text-sm font-mono p-4 outline-none border-r border-border leading-relaxed"
                                spellCheck
                            />

                            {/* @mention popover */}
                            {mention.open && (
                                <div
                                    ref={mentionListRef}
                                    className="absolute bottom-4 left-4 z-50 bg-popover border border-border rounded-md shadow-lg w-60 max-h-48 overflow-y-auto"
                                >
                                    {deferredMentionQuery.length === 0 ? (
                                        <p className="px-3 py-2 text-xs text-muted-foreground">Type to search people…</p>
                                    ) : mentionResults.length === 0 ? (
                                        <p className="px-3 py-2 text-xs text-muted-foreground">No people found</p>
                                    ) : (
                                        mentionResults.map((person) => {
                                            const n = person.names?.[0];
                                            const label = [n?.first, n?.last].filter(Boolean).join(' ') || person.id;
                                            return (
                                                <button
                                                    key={person.id}
                                                    onMouseDown={(e) => { e.preventDefault(); insertMention(person); }}
                                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                                                >
                                                    <span className="font-medium">{label}</span>
                                                    <span className="text-muted-foreground truncate">{person.id}</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                            {/* /slash command menu */}
                            {slashMenu.open && (
                                <div className="absolute bottom-4 left-4 z-50 bg-popover border border-border rounded-md shadow-lg w-48">
                                    <button
                                        onMouseDown={(e) => { e.preventDefault(); insertSlashCommand('image'); }}
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                                    >
                                        <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>/image — Insert photo</span>
                                    </button>
                                    <button
                                        onMouseDown={(e) => { e.preventDefault(); insertSlashCommand('person'); }}
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                                    >
                                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>/person — Mention someone</span>
                                    </button>
                                </div>
                            )}

                            {/* Drop hint */}
                            {!isNew && (
                                <div className="absolute bottom-2 right-2 text-xs text-muted-foreground/50 pointer-events-none">
                                    Drop image to upload
                                </div>
                            )}
                        </div>
                    </ResizablePanel>

                    <ResizableHandle />

                    {/* Right: Live preview */}
                    <ResizablePanel defaultSize={50} minSize={25}>
                        <div className="h-full overflow-hidden border-l border-border bg-background">
                            <div className="px-3 py-1.5 border-b border-border bg-muted/20">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Preview</span>
                            </div>
                            <PreviewContent />
                        </div>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
}
