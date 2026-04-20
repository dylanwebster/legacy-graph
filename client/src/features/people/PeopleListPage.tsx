import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { usePeople, useSearch } from '@/shared/api/hooks';
import type { SlimPersonSummary } from '@/shared/api/people';
import { CustomAvatar } from '@/shared/components/CustomAvatar';
import { loadAvatarCrop } from '@/shared/lib/avatarCrop';
import { CreatePersonDialog } from '@/features/people/components/CreatePersonDialog';
import { TopBarActions } from '@/shared/components/layout/TopBarSlotContext';
import { SearchBar } from '@/shared/components/SearchBar';
import { Badge } from '@/shared/ui/badge';
import { Skeleton } from '@/shared/ui/skeleton';
import { Button } from '@/shared/ui/button';
import { ChevronUp, ChevronDown, ArrowUpDown, UserPlus } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

const PAGE_SIZE = 50;

type SortField = 'birthDate' | 'deathDate' | 'last_modified';
type SortOrder = 'asc' | 'desc';

export function PeopleListPage() {
    const [offset, setOffset] = useState(0);
    const [sort, setSort] = useState<SortField>('last_modified');
    const [order, setOrder] = useState<SortOrder>('desc');
    const [filter, setFilter] = useState('');
    const [debouncedFilter, setDebouncedFilter] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const navigate = useNavigate();

    // Debounce the filter input (300ms)
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedFilter(filter);
            setOffset(0);
        }, 300);
        return () => clearTimeout(timer);
    }, [filter]);

    const isSearchMode = !!debouncedFilter;

    const { data: peopleData, isLoading: peopleLoading, isError: peopleError } = usePeople(
        isSearchMode ? undefined : { limit: PAGE_SIZE, offset, sort, order }
    );
    const { data: searchData, isLoading: searchLoading, isError: searchError } = useSearch(
        debouncedFilter,
        { limit: PAGE_SIZE, offset: 0 }
    );

    const parentRef = useRef<HTMLDivElement>(null);

    const isLoading = isSearchMode ? searchLoading : peopleLoading;
    const isError = isSearchMode ? searchError : peopleError;

    const people: SlimPersonSummary[] = isSearchMode
        ? (searchData?.people ?? [])
        : (peopleData?.people ?? []);

    const searchTotalCount: number = isSearchMode
        ? (searchData?.totalCounts?.people ?? 0)
        : 0;

    const totalCount = isSearchMode ? searchTotalCount : (peopleData?.totalCount ?? 0);

    const rowVirtualizer = useVirtualizer({
        count: people.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 56,
        overscan: 10,
    });

    const toggleSort = useCallback((field: SortField) => {
        if (sort === field) {
            setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSort(field);
            setOrder('asc');
        }
        setOffset(0);
    }, [sort]);

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sort !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
        return order === 'asc'
            ? <ChevronUp className="h-3 w-3 ml-1" />
            : <ChevronDown className="h-3 w-3 ml-1" />;
    };

    const handleRowClick = useCallback((id: string) => {
        navigate({ to: '/people/$id', params: { id } });
    }, [navigate]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

    return (
        <div className="flex flex-col h-full">
            <TopBarActions>
                <div className="w-px h-5 bg-border shrink-0 mx-1" />
                <SearchBar
                    value={filter}
                    onChange={setFilter}
                    placeholder="Search all people…"
                />
                <span className="text-xs text-muted-foreground shrink-0">
                    {isSearchMode
                        ? `${totalCount} result${totalCount === 1 ? '' : 's'}`
                        : `${totalCount} people`}
                </span>
                <Button size="sm" className="gap-1.5 shrink-0 ml-auto" onClick={() => setCreateOpen(true)}>
                    <UserPlus className="h-4 w-4" /> New Person
                </Button>
            </TopBarActions>

            <CreatePersonDialog
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={(id) => navigate({ to: '/people/$id', params: { id } })}
            />

            <div className="px-4 lg:px-6 pt-2">
                <div className="grid grid-cols-[48px_1fr_100px_100px_1fr_60px] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
                    <div></div>
                    <div>Name</div>
                    <button onClick={() => toggleSort('birthDate')} className="flex items-center hover:text-foreground transition-colors text-left">
                        Born <SortIcon field="birthDate" />
                    </button>
                    <button onClick={() => toggleSort('deathDate')} className="flex items-center hover:text-foreground transition-colors text-left">
                        Died <SortIcon field="deathDate" />
                    </button>
                    <div>Tags</div>
                    <div className="text-right">Assets</div>
                </div>
            </div>

            <div ref={parentRef} className="flex-1 overflow-auto px-4 lg:px-6">
                {isLoading ? (
                    <div className="space-y-1 pt-2">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="grid grid-cols-[48px_1fr_100px_100px_1fr_60px] gap-3 px-3 py-3">
                                <Skeleton className="h-8 w-8 rounded-full" />
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-4 w-24" />
                                <Skeleton className="h-4 w-8 ml-auto" />
                            </div>
                        ))}
                    </div>
                ) : isError ? (
                    <div className="p-8 text-center text-muted-foreground">
                        Failed to load people. Is the backend running?
                    </div>
                ) : people.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        {isSearchMode ? `No people matching "${debouncedFilter}"` : 'No people found in the graph'}
                    </div>
                ) : (
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const person: SlimPersonSummary = people[virtualRow.index];
                            const primaryName = person.names?.[0];
                            const firstName = primaryName?.first || primaryName?.given || '';
                            const lastName = primaryName?.last || primaryName?.surname || '';
                            const displayName = `${firstName} ${lastName}`.trim() || 'Unknown';
                            const tags = person.tags ?? [];

                            return (
                                <div
                                    key={person.id}
                                    data-index={virtualRow.index}
                                    ref={rowVirtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                    className="grid grid-cols-[48px_1fr_100px_100px_1fr_60px] gap-3 px-3 py-2 items-center hover:bg-muted/50 cursor-pointer transition-colors rounded"
                                    onClick={() => handleRowClick(person.id)}
                                >
                                    <CustomAvatar
                                        firstName={firstName}
                                        lastName={lastName}
                                        photoFilename={person.primaryAsset}
                                        className="h-8 w-8"
                                        cropData={loadAvatarCrop(person.id)}
                                        sex={person.sex}
                                    />
                                    <span className="font-medium text-sm truncate">{displayName}</span>
                                    <span className="text-sm text-muted-foreground font-mono truncate">
                                        {person.birthDate ?? '—'}
                                    </span>
                                    <span className="text-sm text-muted-foreground font-mono truncate">
                                        {person.deathDate ?? '—'}
                                    </span>
                                    <div className="flex flex-wrap gap-1 overflow-hidden">
                                        {tags.slice(0, 3).map((tag) => (
                                            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                                {tag}
                                            </Badge>
                                        ))}
                                        {tags.length > 3 && (
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                                +{tags.length - 3}
                                            </Badge>
                                        )}
                                    </div>
                                    <span className="text-sm text-muted-foreground text-right font-mono">
                                        {person.assetCount ?? 0}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {!isSearchMode && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-t border-border">
                    <span className="text-sm text-muted-foreground">
                        Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                            Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= totalCount} onClick={() => setOffset(offset + PAGE_SIZE)}>
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
