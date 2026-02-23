import { createLazyFileRoute } from '@tanstack/react-router';
import { usePerson, useUpdatePerson } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import { PersonChip } from '@/components/PersonChip';
import { EventEditorDialog } from '@/components/EventEditorDialog';
import { RelationshipEditorDialog } from '@/components/RelationshipEditorDialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
    Calendar, MapPin, Heart, Skull, GraduationCap, Briefcase, Church,
    Ship, ScrollText, FileText, Plus, ChevronRight, Image, BookOpen, Code,
    Pencil, X, Check, UserPlus,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

export const Route = createLazyFileRoute('/people/$id')({
    component: PersonDetail,
});

const EVENT_ICONS: Record<string, typeof Calendar> = {
    birth: Calendar,
    death: Skull,
    marriage: Heart,
    divorce: Heart,
    education: GraduationCap,
    occupation: Briefcase,
    residence: MapPin,
    immigration: Ship,
    military: ScrollText,
    religious: Church,
    census: FileText,
    baptism: Church,
    burial: Skull,
    generic: Calendar,
    custom: Calendar,
};

const SEX_OPTIONS = ['M', 'F', 'I', 'U'] as const;

function PersonDetail() {
    const { id } = Route.useParams();
    const { data: person, isLoading, isError } = usePerson(id);
    const updatePerson = useUpdatePerson();

    // Inline editing state
    const [editingName, setEditingName] = useState(false);
    const [editFirstName, setEditFirstName] = useState('');
    const [editLastName, setEditLastName] = useState('');
    const [editingSex, setEditingSex] = useState(false);
    const [addingTag, setAddingTag] = useState(false);
    const [newTag, setNewTag] = useState('');

    // Dialog state
    const [eventDialogOpen, setEventDialogOpen] = useState(false);
    const [editingEventIndex, setEditingEventIndex] = useState<number | undefined>(undefined);
    const [relationshipDialogOpen, setRelationshipDialogOpen] = useState(false);

    // Notebook editing state
    const [editingNotebook, setEditingNotebook] = useState(false);
    const [notebookContent, setNotebookContent] = useState('');

    // Drag state for asset upload
    const [isDragOver, setIsDragOver] = useState(false);

    // Timeline virtualizer
    const timelineParentRef = useRef<HTMLDivElement>(null);

    if (isLoading) {
        return (
            <div className="p-6 space-y-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-20 w-20 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </div>
            </div>
        );
    }

    if (isError || !person) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Failed to load person data.
            </div>
        );
    }

    const primaryName = person.names?.[0];
    const firstName = primaryName?.first || primaryName?.given || '';
    const lastName = primaryName?.last || primaryName?.surname || '';
    const displayName = `${firstName} ${lastName}`.trim() || 'Unknown';
    const timeline = person.timeline ?? [];
    const computed = person._computed ?? { currentSpouse: null, siblings: [], children: [], allSpouses: [] };
    const tags = person.tags ?? [];

    // Derive birth/death dates from events
    const events = (person.events ?? []) as Array<Record<string, unknown>>;
    const birthDate = events.find((e) => e.type === 'birth')?.date as string | undefined;
    const deathDate = events.find((e) => e.type === 'death')?.date as string | undefined;

    const parentIds = person.relationships?.parents ?? [];
    const spouseIds = computed.allSpouses?.map((s) => s.id) ?? [];
    const childIds = computed.children ?? [];
    const siblingIds = computed.siblings ?? [];

    const hasRelationships = parentIds.length > 0 || spouseIds.length > 0 || childIds.length > 0 || siblingIds.length > 0;

    // --- Name editing ---
    const startEditName = () => {
        setEditFirstName(firstName);
        setEditLastName(lastName);
        setEditingName(true);
    };

    const saveNameEdit = () => {
        const updatedNames = person.names ? [...person.names] : [];
        if (updatedNames.length > 0) {
            updatedNames[0] = {
                ...updatedNames[0],
                given: editFirstName.trim(),
                first: editFirstName.trim(),
                surname: editLastName.trim(),
                last: editLastName.trim(),
            };
        } else {
            updatedNames.push({ given: editFirstName.trim(), surname: editLastName.trim(), primary: true });
        }
        updatePerson.mutate(
            { id, updates: { names: updatedNames } },
            {
                onSuccess: () => toast.success('Name updated.'),
                onError: () => toast.error('Failed to update name.'),
            }
        );
        setEditingName(false);
    };

    const cancelNameEdit = () => setEditingName(false);

    // --- Sex editing ---
    const saveSex = (newSex: string) => {
        setEditingSex(false);
        updatePerson.mutate(
            { id, updates: { sex: newSex } },
            {
                onSuccess: () => toast.success('Sex updated.'),
                onError: () => toast.error('Failed to update sex.'),
            }
        );
    };

    // --- Tag editing ---
    const addTag = () => {
        const tag = newTag.trim();
        if (!tag) return;
        if (tags.includes(tag)) { toast.error('Tag already exists.'); return; }
        const updated = [...tags, tag];
        updatePerson.mutate(
            { id, updates: { tags: updated } },
            {
                onSuccess: () => toast.success('Tag added.'),
                onError: () => toast.error('Failed to add tag.'),
            }
        );
        setNewTag('');
        setAddingTag(false);
    };

    const removeTag = (tag: string) => {
        const updated = tags.filter((t: string) => t !== tag);
        updatePerson.mutate(
            { id, updates: { tags: updated } },
            {
                onSuccess: () => toast.success('Tag removed.'),
                onError: () => toast.error('Failed to remove tag.'),
            }
        );
    };

    // --- Notebook editing ---
    const startEditNotebook = () => {
        setNotebookContent(person.scrapbook_md ?? '');
        setEditingNotebook(true);
    };

    const saveNotebook = () => {
        updatePerson.mutate(
            { id, updates: { scrapbook_md: notebookContent } },
            {
                onSuccess: () => toast.success('Notebook saved.'),
                onError: () => toast.error('Failed to save notebook.'),
            }
        );
        setEditingNotebook(false);
    };

    // --- Asset drag-drop upload ---
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(`/api/people/${id}/media`, { method: 'PUT', body: formData });
            if (!res.ok) throw new Error('Upload failed');
            toast.success('Asset uploaded.');
            // Invalidate person query to refresh assets
            updatePerson.mutate({ id, updates: {} });
        } catch {
            toast.error('Failed to upload asset.');
        }
    };

    // --- Event editor ---
    const openAddEvent = () => {
        setEditingEventIndex(undefined);
        setEventDialogOpen(true);
    };

    const openEditEvent = (idx: number) => {
        setEditingEventIndex(idx);
        setEventDialogOpen(true);
    };

    const existingEvent = editingEventIndex !== undefined ? events[editingEventIndex] : undefined;

    return (
        <>
            <ResizablePanelGroup orientation="horizontal" className="h-full">
                {/* Identity Panel */}
                <ResizablePanel defaultSize="22%" minSize="15%" maxSize="35%">
                    <div className="h-full overflow-y-auto p-4 space-y-6">
                        {/* Avatar + Name */}
                        <div className="flex flex-col items-center text-center gap-3 pt-2">
                            <CustomAvatar
                                firstName={primaryName?.given ?? firstName}
                                lastName={primaryName?.surname ?? lastName}
                                photoFilename={person.assets?.[0]}
                                className="h-20 w-20 text-2xl"
                            />
                            <div className="w-full">
                                {editingName ? (
                                    <div className="space-y-2">
                                        <Input
                                            value={editFirstName}
                                            onChange={(e) => setEditFirstName(e.target.value)}
                                            placeholder="First name"
                                            className="h-7 text-sm text-center"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveNameEdit();
                                                if (e.key === 'Escape') cancelNameEdit();
                                            }}
                                            autoFocus
                                        />
                                        <Input
                                            value={editLastName}
                                            onChange={(e) => setEditLastName(e.target.value)}
                                            placeholder="Last name"
                                            className="h-7 text-sm text-center"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveNameEdit();
                                                if (e.key === 'Escape') cancelNameEdit();
                                            }}
                                        />
                                        <div className="flex gap-1 justify-center">
                                            <Button size="sm" className="h-6 px-2 text-xs" onClick={saveNameEdit}>
                                                <Check className="h-3 w-3" />
                                            </Button>
                                            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={cancelNameEdit}>
                                                <X className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={startEditName}
                                        className="group flex items-center justify-center gap-1 w-full"
                                        title="Click to edit name"
                                    >
                                        <h2 className="text-xl font-bold tracking-tight">{displayName}</h2>
                                        <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                )}
                                {person.names?.length > 1 && !editingName && (
                                    <p className="text-sm text-muted-foreground mt-0.5">
                                        {person.names.slice(1).map((n: typeof primaryName) => `${n?.first || n?.given || ''} ${n?.last || n?.surname || ''}`.trim()).join(', ')}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Vital dates + sex */}
                        <div className="space-y-2 border-t border-border pt-4">
                            <div className="flex items-center gap-2 text-sm">
                                {editingSex ? (
                                    <div className="flex gap-1.5 flex-wrap">
                                        {SEX_OPTIONS.map((s) => (
                                            <button
                                                key={s}
                                                onClick={() => saveSex(s)}
                                                className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                                                    person.sex === s
                                                        ? 'bg-primary text-primary-foreground border-primary'
                                                        : 'border-border hover:bg-muted'
                                                }`}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => setEditingSex(false)}
                                            className="p-0.5 rounded hover:bg-muted"
                                        >
                                            <X className="h-3 w-3 text-muted-foreground" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setEditingSex(true)}
                                        className="group flex items-center gap-1"
                                        title="Click to edit sex"
                                    >
                                        <Badge variant="outline" className="text-xs px-1.5">{person.sex ?? 'U'}</Badge>
                                        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                )}
                            </div>
                            {birthDate && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Calendar className="h-4 w-4 shrink-0" />
                                    <span>b. {birthDate}</span>
                                </div>
                            )}
                            {deathDate && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Skull className="h-4 w-4 shrink-0" />
                                    <span>d. {deathDate}</span>
                                </div>
                            )}
                        </div>

                        {/* Relationships */}
                        <div className="space-y-3 border-t border-border pt-4">
                            {hasRelationships && (
                                <>
                                    <RelationshipSection title="Parents" ids={parentIds.map((p) => p.id)} />
                                    <RelationshipSection title="Spouses" ids={spouseIds} />
                                    <RelationshipSection title="Children" ids={childIds} />
                                    <RelationshipSection title="Siblings" ids={siblingIds} />
                                </>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full gap-1.5 text-xs"
                                onClick={() => setRelationshipDialogOpen(true)}
                            >
                                <UserPlus className="h-3.5 w-3.5" />
                                Manage Parents
                            </Button>
                        </div>

                        {/* Tags */}
                        <div className="space-y-2 border-t border-border pt-4">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {tags.map((tag: string) => (
                                    <div key={tag} className="group flex items-center gap-0.5">
                                        <Badge variant="secondary" className="text-xs pr-1">{tag}</Badge>
                                        <button
                                            onClick={() => removeTag(tag)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                                            aria-label={`Remove tag ${tag}`}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                                {addingTag ? (
                                    <div className="flex items-center gap-1">
                                        <Input
                                            value={newTag}
                                            onChange={(e) => setNewTag(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') addTag();
                                                if (e.key === 'Escape') { setAddingTag(false); setNewTag(''); }
                                            }}
                                            placeholder="tag"
                                            className="h-6 w-20 text-xs"
                                            autoFocus
                                        />
                                        <button onClick={addTag} className="hover:text-primary">
                                            <Check className="h-3 w-3" />
                                        </button>
                                        <button onClick={() => { setAddingTag(false); setNewTag(''); }}>
                                            <X className="h-3 w-3 text-muted-foreground" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setAddingTag(true)}
                                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-border hover:border-primary transition-colors"
                                    >
                                        <Plus className="h-3 w-3" /> Add
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Timeline Panel */}
                <ResizablePanel defaultSize="50%" minSize="30%">
                    <div className="h-full flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <h3 className="text-sm font-semibold">Timeline</h3>
                            <Button variant="outline" size="sm" className="gap-1" onClick={openAddEvent}>
                                <Plus className="h-3 w-3" /> Add Event
                            </Button>
                        </div>
                        <div ref={timelineParentRef} className="flex-1 overflow-y-auto">
                            <VirtualizedTimeline
                                timeline={timeline as Array<Record<string, unknown>>}
                                parentRef={timelineParentRef}
                                onEditEvent={openEditEvent}
                            />
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Context Panel */}
                <ResizablePanel defaultSize="28%" minSize="15%" maxSize="40%">
                    <Tabs defaultValue="assets" className="h-full flex flex-col">
                        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2 pt-1">
                            <TabsTrigger value="assets" className="gap-1.5 text-xs">
                                <Image className="h-3.5 w-3.5" /> Assets
                            </TabsTrigger>
                            <TabsTrigger value="notebook" className="gap-1.5 text-xs">
                                <BookOpen className="h-3.5 w-3.5" /> Notebook
                            </TabsTrigger>
                            <TabsTrigger value="gedcom" className="gap-1.5 text-xs">
                                <Code className="h-3.5 w-3.5" /> GEDCOM
                            </TabsTrigger>
                        </TabsList>

                        {/* Assets tab with drag-drop */}
                        <TabsContent value="assets" className="flex-1 overflow-auto p-4 mt-0">
                            <div
                                className={`min-h-[80px] rounded-lg border-2 border-dashed transition-colors mb-3 flex items-center justify-center text-xs text-muted-foreground ${
                                    isDragOver ? 'border-primary bg-primary/5' : 'border-border'
                                }`}
                                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={handleDrop}
                            >
                                {isDragOver ? 'Drop to upload' : 'Drag & drop an image here'}
                            </div>
                            {person.assets?.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {person.assets.map((asset: string, idx: number) => (
                                        <div key={idx} className="aspect-square rounded-lg bg-muted border border-border flex items-center justify-center overflow-hidden">
                                            <img src={`/assets/${asset}`} alt={asset} className="object-cover w-full h-full" loading="lazy" />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center text-muted-foreground text-sm">No assets</div>
                            )}
                        </TabsContent>

                        {/* Notebook tab with edit toggle */}
                        <TabsContent value="notebook" className="flex-1 overflow-auto p-4 mt-0 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</span>
                                {editingNotebook ? (
                                    <div className="flex gap-1">
                                        <Button size="sm" className="h-6 px-2 text-xs" onClick={saveNotebook}>Save</Button>
                                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setEditingNotebook(false)}>Cancel</Button>
                                    </div>
                                ) : (
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={startEditNotebook}>
                                        <Pencil className="h-3 w-3" /> Edit
                                    </Button>
                                )}
                            </div>
                            {editingNotebook ? (
                                <textarea
                                    value={notebookContent}
                                    onChange={(e) => setNotebookContent(e.target.value)}
                                    rows={12}
                                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none font-mono"
                                />
                            ) : person.scrapbook_md ? (
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                    <pre className="whitespace-pre-wrap font-sans text-sm">{person.scrapbook_md}</pre>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    No notebook entries. Click Edit to add notes.
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="gedcom" className="flex-1 overflow-auto p-4 mt-0">
                            {person._gedcom ? (
                                <pre className="text-xs font-mono bg-muted/50 p-4 rounded-lg overflow-auto whitespace-pre-wrap">
                                    {JSON.stringify(person._gedcom, null, 2)}
                                </pre>
                            ) : (
                                <div className="p-8 text-center text-muted-foreground text-sm">No GEDCOM data available</div>
                            )}
                        </TabsContent>
                    </Tabs>
                </ResizablePanel>
            </ResizablePanelGroup>

            {/* Dialogs */}
            <EventEditorDialog
                isOpen={eventDialogOpen}
                onClose={() => { setEventDialogOpen(false); setEditingEventIndex(undefined); }}
                personId={id}
                existingEvent={existingEvent}
                existingEventIndex={editingEventIndex}
                currentEvents={events}
            />
            <RelationshipEditorDialog
                isOpen={relationshipDialogOpen}
                onClose={() => setRelationshipDialogOpen(false)}
                personId={id}
                currentParents={person.relationships?.parents ?? []}
            />
        </>
    );
}

// Virtualized timeline using @tanstack/react-virtual
function VirtualizedTimeline({
    timeline,
    parentRef,
    onEditEvent,
}: {
    timeline: Array<Record<string, unknown>>;
    parentRef: React.RefObject<HTMLDivElement | null>;
    onEditEvent: (idx: number) => void;
}) {
    const rowVirtualizer = useVirtualizer({
        count: timeline.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 80,
        overscan: 5,
    });

    if (timeline.length === 0) {
        return (
            <div className="p-8 text-center text-muted-foreground text-sm">
                No events recorded yet.
            </div>
        );
    }

    return (
        <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
            className="px-4 py-3"
        >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const event = timeline[virtualItem.index];
                const IconComp = EVENT_ICONS[event.type as string] ?? Calendar;
                const isGap = event.type === '__gap__';

                return (
                    <div
                        key={virtualItem.key}
                        data-index={virtualItem.index}
                        ref={rowVirtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${virtualItem.start}px)`,
                        }}
                        className="pb-3"
                    >
                        {isGap ? (
                            <div className="flex items-center gap-2 py-2 px-3">
                                <div className="h-px flex-1 bg-border" />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {String(event.label ?? '—')}
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>
                        ) : (
                            <button
                                className="w-full flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors group text-left"
                                onClick={() => {
                                    // Find actual index in events array (not timeline which may include stories/gaps)
                                    onEditEvent(virtualItem.index);
                                }}
                            >
                                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10">
                                    <IconComp className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm capitalize">{String(event.type ?? '')}</span>
                                        {!!event.date && (
                                            <span className="text-xs text-muted-foreground font-mono">{String(event.date)}</span>
                                        )}
                                    </div>
                                    {!!event.location && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                            <MapPin className="h-3 w-3" />
                                            <span className="truncate">{String(event.location)}</span>
                                        </div>
                                    )}
                                    {!!event.description && (
                                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{String(event.description)}</p>
                                    )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-muted-foreground self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function RelationshipSection({ title, ids }: { title: string; ids?: string[] }) {
    if (!ids || ids.length === 0) return null;
    return (
        <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</h3>
            <div className="space-y-1">
                {ids.map((id) => (
                    <PersonChip key={id} id={id} />
                ))}
            </div>
        </div>
    );
}
