import { useRef, useEffect, useCallback } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useStories, useDeleteStory } from '@/shared/api/hooks';
import type { StoryFeedItem } from '@/shared/api/stories';
import { PersonChip } from '@/shared/components/PersonChip';
import { AssetSearchBar } from '@/components/AssetSearchBar';
import type { PersonChipData } from '@/components/AssetSearchBar';
import { TopBarActions } from '@/shared/components/layout/TopBarSlotContext';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Skeleton } from '@/shared/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/shared/ui/dialog';
import { useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Trash2, MapPin, Users, CalendarDays, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { useUIStore } from '@/shared/store/uiStore';
import type { StoriesSortKey } from '@/shared/store/uiStore';
import { formatPlaceDisplay } from '@/shared/lib/places';

export const Route = createLazyFileRoute('/stories/')({
    component: StoriesFeed,
});

const SORT_OPTIONS: { key: StoriesSortKey; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'alpha', label: 'A–Z' },
    { key: 'created', label: 'Added' },
    { key: 'modified', label: 'Edited' },
];

/** Map (sortKey, order) → backend sort param. */
function toBackendSort(key: StoriesSortKey, order: 'asc' | 'desc'): string {
    if (key === 'date') return order === 'desc' ? 'newest' : 'oldest';
    if (key === 'created') return order === 'desc' ? 'created_newest' : 'created_oldest';
    if (key === 'modified') return order === 'desc' ? 'modified_newest' : 'modified_oldest';
    return 'alpha'; // backend always returns A-Z; frontend reverses for desc (Z-A)
}

function StoriesFeed() {
    const navigate = useNavigate();
    const { storiesFeedFilter, storiesFeedSortKey, storiesFeedSortOrder, setStoriesFeed } = useUIStore();

    // Local state mirrors Zustand but allows debouncing
    const [filter, setFilter] = useState(storiesFeedFilter);
    const [sortKey, setSortKey] = useState<StoriesSortKey>(storiesFeedSortKey);
    const [order, setOrder] = useState<'asc' | 'desc'>(storiesFeedSortOrder);
    const [debouncedFilter, setDebouncedFilter] = useState(storiesFeedFilter);
    const [deleteTarget, setDeleteTarget] = useState<StoryFeedItem | null>(null);
    const [chips, setChips] = useState<PersonChipData[]>([]);

    // Debounce filter
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFilter(filter);
            setStoriesFeed(filter, sortKey, order);
        }, 300);
        return () => clearTimeout(timer);
    }, [filter, sortKey, order, setStoriesFeed]);

    // Persist sort changes immediately
    useEffect(() => {
        setStoriesFeed(filter, sortKey, order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortKey, order]);

    const isChipsMode = chips.length > 0;
    const isSearchMode = !!debouncedFilter;

    const { data: storiesData, isLoading } = useStories({
        sort: toBackendSort(sortKey, order),
        q: debouncedFilter || undefined,
        personIds: chips.length > 0 ? chips.map(c => c.id) : undefined,
    });
    const deleteStory = useDeleteStory();

    // Backend always returns A-Z for alpha; reverse client-side for Z-A
    const baseStories: StoryFeedItem[] = storiesData?.stories ?? [];
    const stories = (sortKey === 'alpha' && order === 'desc')
        ? [...baseStories].reverse()
        : baseStories;
    const totalCount = storiesData?.totalCount ?? stories.length;

    // Stable key derived from query inputs — ensures the virtualizer fully remounts
    // whenever the list content or ordering changes (fixes stale position measurements).
    // Derived from inputs rather than all story IDs to avoid O(n) work on every render.
    const listKey = [sortKey, order, debouncedFilter || '', chips.map(c => c.id).join('|')].join(':');

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        try {
            await deleteStory.mutateAsync(deleteTarget.id);
            toast.success(`Deleted "${deleteTarget.title}"`);
        } catch {
            toast.error('Failed to delete story');
        } finally {
            setDeleteTarget(null);
        }
    }, [deleteTarget, deleteStory]);

    return (
        <div className="flex flex-col h-full">
            <TopBarActions>
                <div className="w-px h-5 bg-border shrink-0 mx-1" />
                <AssetSearchBar
                    textValue={filter}
                    onTextChange={setFilter}
                    selectedPeople={chips}
                    onAddPerson={(id, name) => setChips((prev) => prev.some((c) => c.id === id) ? prev : [...prev, { id, name }])}
                    onRemovePerson={(id) => setChips((prev) => prev.filter((c) => c.id !== id))}
                />
                {/* Sort */}
                {!isSearchMode && (
                    <div className="flex items-center gap-1 shrink-0">
                        {SORT_OPTIONS.map(({ key, label }) => {
                            const isActive = sortKey === key;
                            const SortIcon = isActive
                                ? order === 'asc' ? ArrowUp : ArrowDown
                                : ArrowUpDown;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => {
                                        if (isActive) {
                                            setOrder(o => o === 'asc' ? 'desc' : 'asc');
                                        } else {
                                            setSortKey(key);
                                            setOrder(key === 'alpha' ? 'asc' : 'desc');
                                        }
                                    }}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                                        isActive
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                    }`}
                                >
                                    {label}
                                    <SortIcon className={`h-3 w-3 ${isActive ? '' : 'opacity-40'}`} />
                                </button>
                            );
                        })}
                    </div>
                )}
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {totalCount} {totalCount === 1 ? 'story' : 'stories'}
                </span>
                <Button
                    size="sm"
                    className="h-8 gap-1.5 shrink-0"
                    onClick={() => navigate({ to: '/stories/$id', params: { id: 'new' } })}
                >
                    <Plus className="h-4 w-4" />
                    New Story
                </Button>
            </TopBarActions>

            {/* Feed */}
            {isLoading ? (
                <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-40 w-full rounded-lg" />
                        ))}
                    </div>
                </div>
            ) : stories.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <span className="text-4xl">📖</span>
                    <p className="text-sm">
                        {isChipsMode
                            ? 'No stories mention all selected people.'
                            : isSearchMode
                                ? 'No stories match your search.'
                                : 'No stories yet.'}
                    </p>
                    {!isSearchMode && !isChipsMode && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate({ to: '/stories/$id', params: { id: 'new' } })}
                        >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Write your first story
                        </Button>
                    )}
                </div>
            ) : (
                <StoryFeedList
                    key={listKey}
                    stories={stories}
                    onDelete={setDeleteTarget}
                />
            )}

            {/* Delete confirmation */}
            <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Story</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete "{deleteTarget?.title}"? This cannot be
                            undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={deleteStory.isPending}
                        >
                            {deleteStory.isPending ? 'Deleting…' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** Virtualizer lives here so it fully remounts (and resets measurements) when `key` changes. */
function StoryFeedList({
    stories,
    onDelete,
}: {
    stories: StoryFeedItem[];
    onDelete: (story: StoryFeedItem) => void;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: stories.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 180,
        overscan: 5,
    });

    return (
        <div ref={parentRef} className="flex-1 overflow-y-auto pt-4">
            <div
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
                className="max-w-3xl mx-auto px-4 py-4"
            >
                {virtualizer.getVirtualItems().map((vItem) => {
                    const story = stories[vItem.index];
                    return (
                        <div
                            key={story.id}
                            style={{
                                position: 'absolute',
                                top: vItem.start,
                                left: 0,
                                right: 0,
                                padding: '0 1rem',
                            }}
                            data-index={vItem.index}
                            ref={virtualizer.measureElement}
                        >
                            <StoryFeedCard story={story} onDelete={() => onDelete(story)} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function StoryFeedCard({
    story,
    onDelete,
}: {
    story: StoryFeedItem;
    onDelete: () => void;
}) {
    const navigate = useNavigate();

    const goToStory = () => navigate({ to: '/stories/$id', params: { id: story.id } });

    return (
        <div
            className="group relative bg-card border border-border rounded-lg overflow-hidden mb-4 hover:border-primary/30 transition-colors cursor-pointer"
            onClick={goToStory}
            role="article"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToStory(); } }}
        >
            {/* Hero image */}
            {story.firstAsset && (
                <div className="aspect-[16/9] w-full overflow-hidden bg-muted">
                    <img
                        src={`/assets/${story.firstAsset}`}
                        alt={story.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                </div>
            )}

            <div className="p-4">
                {/* Title */}
                <h2 className="font-semibold text-base leading-snug group-hover:text-primary transition-colors line-clamp-2">
                    {story.title}
                </h2>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                    {story.date && (
                        <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {story.date}
                        </span>
                    )}
                    {!!story.place && (
                        <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {formatPlaceDisplay(story.place)}
                        </span>
                    )}
                    {story.private && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Private
                        </Badge>
                    )}
                </div>

                {/* Excerpt */}
                {story.excerpt && (
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-4 leading-relaxed">
                        {story.excerpt}
                    </p>
                )}

                {/* Tagged people */}
                {story.people.length > 0 && (
                    <div
                        className="flex flex-wrap items-center gap-1 mt-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                        {story.people.slice(0, 5).map((personId) => (
                            <PersonChip key={personId} id={personId} />
                        ))}
                        {story.people.length > 5 && (
                            <span className="text-xs text-muted-foreground">
                                +{story.people.length - 5} more
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Delete button (hover) */}
            <button
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-background/80 hover:bg-destructive/10 hover:text-destructive text-muted-foreground z-10"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                aria-label="Delete story"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
