import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { usePerson } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
    Calendar, MapPin, Heart, Skull, GraduationCap, Briefcase, Church,
    Ship, ScrollText, FileText, Plus, ChevronRight, Image, BookOpen, Code
} from 'lucide-react';

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
    custom: Calendar,
};

function PersonDetail() {
    const { id } = Route.useParams();
    const { data: person, isLoading, isError } = usePerson(id);

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
    const events = (person.events ?? []) as Array<Record<string, string>>;
    const birthDate = events.find((e) => e.type === 'birth')?.date;
    const deathDate = events.find((e) => e.type === 'death')?.date;

    // Build relationship ID arrays from the actual _computed shape
    const parentIds = person.relationships?.parents?.map((p) => p.id) ?? [];
    const spouseIds = computed.allSpouses?.map((s) => s.id) ?? [];
    const childIds = computed.children ?? [];
    const siblingIds = computed.siblings ?? [];

    const hasRelationships = parentIds.length > 0 || spouseIds.length > 0 || childIds.length > 0 || siblingIds.length > 0;

    return (
        <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Identity Panel */}
            <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
                <div className="h-full overflow-y-auto p-4 space-y-6">
                    {/* Avatar + Name */}
                    <div className="flex flex-col items-center text-center gap-3 pt-2">
                        <CustomAvatar
                            firstName={primaryName?.given ?? firstName}
                            lastName={primaryName?.surname ?? lastName}
                            photoFilename={person.assets?.[0]}
                            className="h-20 w-20 text-2xl"
                        />
                        <div>
                            <h2 className="text-xl font-bold tracking-tight">{displayName}</h2>
                            {person.names?.length > 1 && (
                                <p className="text-sm text-muted-foreground mt-0.5">
                                    {person.names.slice(1).map((n) => `${n.first || n.given || ''} ${n.last || n.surname || ''}`.trim()).join(', ')}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Vital dates */}
                    <div className="space-y-2 border-t border-border pt-4">
                        <div className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="text-xs px-1.5">{person.sex ?? 'U'}</Badge>
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
                    {hasRelationships && (
                        <div className="space-y-3 border-t border-border pt-4">
                            <RelationshipSection title="Parents" ids={parentIds} />
                            <RelationshipSection title="Spouses" ids={spouseIds} />
                            <RelationshipSection title="Children" ids={childIds} />
                            <RelationshipSection title="Siblings" ids={siblingIds} />
                        </div>
                    )}

                    {/* Tags */}
                    {tags.length > 0 && (
                        <div className="space-y-2 border-t border-border pt-4">
                            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {tags.map((tag: string) => (
                                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Timeline Panel */}
            <ResizablePanel defaultSize={50} minSize={30}>
                <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <h3 className="text-sm font-semibold">Timeline</h3>
                        <Button variant="outline" size="sm" className="gap-1">
                            <Plus className="h-3 w-3" /> Add Event
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {timeline.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                No events recorded yet.
                            </div>
                        ) : (
                            (timeline as Array<Record<string, string>>).map((event, idx: number) => {
                                const IconComp = EVENT_ICONS[event.type] ?? Calendar;
                                return (
                                    <div
                                        key={idx}
                                        className="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors group"
                                    >
                                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10">
                                            <IconComp className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm capitalize">{event.type}</span>
                                                {event.date && (
                                                    <span className="text-xs text-muted-foreground font-mono">{event.date}</span>
                                                )}
                                            </div>
                                            {event.location && (
                                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                                    <MapPin className="h-3 w-3" />
                                                    <span className="truncate">{event.location}</span>
                                                </div>
                                            )}
                                            {event.description && (
                                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{event.description}</p>
                                            )}
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Context Panel */}
            <ResizablePanel defaultSize={28} minSize={15} maxSize={40}>
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
                    <TabsContent value="assets" className="flex-1 overflow-auto p-4 mt-0">
                        {person.assets?.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                                {person.assets.map((asset: string, idx: number) => (
                                    <div key={idx} className="aspect-square rounded-lg bg-muted border border-border flex items-center justify-center overflow-hidden">
                                        <img src={`/assets/${asset}`} alt={asset} className="object-cover w-full h-full" loading="lazy" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground text-sm">No assets</div>
                        )}
                    </TabsContent>
                    <TabsContent value="notebook" className="flex-1 overflow-auto p-4 mt-0">
                        {person.scrapbook_md ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                                <pre className="whitespace-pre-wrap font-sans text-sm">{person.scrapbook_md}</pre>
                            </div>
                        ) : (
                            <div className="p-8 text-center text-muted-foreground text-sm">No notebook entries</div>
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
    );
}

function RelationshipSection({ title, ids }: { title: string; ids?: string[] }) {
    if (!ids || ids.length === 0) return null;
    return (
        <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</h3>
            <div className="space-y-1">
                {ids.map((id) => (
                    <Link
                        key={id}
                        to="/people/$id"
                        params={{ id }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-sm"
                    >
                        <CustomAvatar className="h-6 w-6 text-[10px]" />
                        <span className="truncate font-mono text-xs">{id}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}
