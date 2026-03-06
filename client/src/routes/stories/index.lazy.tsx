import { useRef, useEffect, useCallback } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useStories, useDeleteStory, useSearch } from '@/api/hooks';
import type { StoryFeedItem } from '@/api/stories';
import { PersonChip } from '@/components/PersonChip';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Plus, Trash2, MapPin, Users, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { useUIStore } from '@/store/uiStore';
import type { StoriesSortMode } from '@/store/uiStore';

export const Route = createLazyFileRoute('/stories/')({
    component: StoriesFeed,
});

const SORT_OPTIONS: { value: StoriesSortMode; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
    { value: 'alpha', label: 'A–Z' },
];

function StoriesFeed() {
    const navigate = useNavigate();
    const { storiesFeedFilter, storiesFeedSort, setStoriesFeed } = useUIStore();

    // Local state mirrors Zustand but allows debouncing
    const [filter, setFilter] = useState(storiesFeedFilter);
    const [sort, setSort] = useState<StoriesSortMode>(storiesFeedSort);
    const [debouncedFilter, setDebouncedFilter] = useState(storiesFeedFilter);
    const [deleteTarget, setDeleteTarget] = useState<StoryFeedItem | null>(null);

    // Debounce filter
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFilter(filter);
            setStoriesFeed(filter, sort);
        }, 300);
        return () => clearTimeout(timer);
    }, [filter, sort, setStoriesFeed]);

    // Persist sort changes immediately
    useEffect(() => {
        setStoriesFeed(filter, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sort]);

    const isSearchMode = !!debouncedFilter;

    const { data: storiesData, isLoading: storiesLoading } = useStories(
        isSearchMode ? undefined : { sort }
    );
    const { data: searchData, isLoading: searchLoading } = useSearch(
        debouncedFilter,
        { limit: 50 }
    );
    const deleteStory = useDeleteStory();

    const stories: StoryFeedItem[] = isSearchMode
        ? ((searchData as any)?.stories ?? [])
        : (storiesData?.stories ?? []);

    const totalCount = isSearchMode
        ? ((searchData as any)?.totalCounts?.stories ?? stories.length)
        : (storiesData?.totalCount ?? 0);

    const isLoading = isSearchMode ? searchLoading : storiesLoading;

    const parentRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: stories.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 180,
        overscan: 5,
    });

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
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                        className="pl-8 h-8 text-sm"
                        placeholder="Search stories…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                </div>

                {/* Sort toggle */}
                {!isSearchMode && (
                    <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                        {SORT_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setSort(opt.value)}
                                className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                                    sort === opt.value
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                )}

                <span className="text-xs text-muted-foreground ml-auto">
                    {totalCount} {totalCount === 1 ? 'story' : 'stories'}
                </span>

                <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => navigate({ to: '/stories/$id', params: { id: 'new' } })}
                >
                    <Plus className="h-4 w-4" />
                    New Story
                </Button>
            </div>

            {/* Feed */}
            <div ref={parentRef} className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-40 w-full rounded-lg" />
                        ))}
                    </div>
                ) : stories.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
                        <span className="text-4xl">📖</span>
                        <p className="text-sm">
                            {isSearchMode ? 'No stories match your search.' : 'No stories yet.'}
                        </p>
                        {!isSearchMode && (
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
                                    <StoryFeedCard
                                        story={story}
                                        onDelete={() => setDeleteTarget(story)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

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
                    {story.place && (
                        <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {story.place}
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
                    <p className="mt-2 text-sm text-muted-foreground line-clamp-3 leading-relaxed">
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
