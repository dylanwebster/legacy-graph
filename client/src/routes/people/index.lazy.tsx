import { useState, useCallback, useRef } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { usePeople } from '@/api/hooks';
import type { SlimPersonSummary } from '@/api/people';
import { CustomAvatar } from '@/components/CustomAvatar';
import { CreatePersonDialog } from '@/components/CreatePersonDialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Search, ChevronUp, ChevronDown, ArrowUpDown, UserPlus } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

export const Route = createLazyFileRoute('/people/')({
    component: PeopleBrowse,
});

const PAGE_SIZE = 50;

type SortField = 'birthDate' | 'deathDate' | 'last_modified';
type SortOrder = 'asc' | 'desc';

function PeopleBrowse() {
    const [offset, setOffset] = useState(0);
    const [sort, setSort] = useState<SortField>('last_modified');
    const [order, setOrder] = useState<SortOrder>('desc');
    const [filter, setFilter] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const navigate = useNavigate();

    const { data, isLoading, isError } = usePeople({ limit: PAGE_SIZE, offset, sort, order });

    const parentRef = useRef<HTMLDivElement>(null);

    const people = data?.people ?? [];
    const totalCount = data?.totalCount ?? 0;

    const filtered = filter
        ? people.filter((p) => {
            const nameStr = p.names?.map((n) => `${n.first || n.given || ''} ${n.last || n.surname || ''}`).join(' ').toLowerCase() ?? '';
            return nameStr.includes(filter.toLowerCase());
        })
        : people;

    const rowVirtualizer = useVirtualizer({
        count: filtered.length,
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
            <div className="flex items-center justify-between p-4 lg:p-6 pb-0">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">People</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {totalCount > 0 ? `${totalCount} people in the graph` : 'Browse all people'}
                    </p>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                    <UserPlus className="h-4 w-4" /> New Person
                </Button>
            </div>

            <CreatePersonDialog
                isOpen={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={(id) => navigate({ to: '/people/$id', params: { id } })}
            />

            <div className="px-4 lg:px-6 pt-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Filter by name..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="pl-9 bg-muted/30"
                    />
                </div>
            </div>

            <div className="px-4 lg:px-6 pt-4">
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
                ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                        {filter ? `No people matching "${filter}"` : 'No people found in the graph'}
                    </div>
                ) : (
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const person: SlimPersonSummary = filtered[virtualRow.index];
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
                                        className="h-8 w-8"
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

            {totalPages > 1 && (
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
