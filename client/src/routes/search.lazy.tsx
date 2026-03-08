import { createLazyFileRoute, useSearch as useRouterSearch } from '@tanstack/react-router';
import { useSearch } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Search, Users, BookOpen, MapPin } from 'lucide-react';

export const Route = createLazyFileRoute('/search')({
    component: SearchPage,
});

function SearchPage() {
    const routerSearch = useRouterSearch({ from: '/search' }) as Record<string, string>;
    const initialQuery = routerSearch?.q ?? '';
    const [query, setQuery] = useState(initialQuery);
    const navigate = useNavigate();

    const { data, isLoading } = useSearch(query || initialQuery, { limit: 50 });

    const people = data?.people ?? [];
    const stories = data?.stories ?? [];
    const places = data?.places ?? [];
    const hasResults = people.length > 0 || stories.length > 0 || places.length > 0;

    return (
        <div className="h-full overflow-auto p-6 max-w-4xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold tracking-tight">Search Results</h1>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search people, stories, places..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                />
            </div>

            {isLoading && (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full rounded-lg" />
                    ))}
                </div>
            )}

            {!isLoading && !hasResults && (query || initialQuery) && (
                <div className="p-8 text-center text-muted-foreground">
                    No results found for "{query || initialQuery}"
                </div>
            )}

            {people.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Users className="h-5 w-5" /> People ({people.length})
                    </h2>
                    <div className="space-y-2">
                        {people.map((person) => {
                            const n = person.names?.[0];
                            const firstName = n?.first ?? n?.given ?? '';
                            const lastName = n?.last ?? n?.surname ?? '';
                            const displayName = [firstName, lastName].filter(Boolean).join(' ') || person.id;
                            return (
                                <Button
                                    key={person.id}
                                    variant="ghost"
                                    className="w-full justify-start h-auto p-3 gap-3"
                                    onClick={() => navigate({ to: '/people/$id', params: { id: person.id } })}
                                >
                                    <CustomAvatar
                                        firstName={firstName}
                                        lastName={lastName}
                                        className="h-10 w-10"
                                    />
                                    <div className="text-left min-w-0">
                                        <div className="font-medium">{displayName}</div>
                                        {!!person.birthDate && (
                                            <div className="text-xs text-muted-foreground truncate">{person.birthDate}</div>
                                        )}
                                    </div>
                                </Button>
                            );
                        })}
                    </div>
                </div>
            )}

            {stories.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <BookOpen className="h-5 w-5" /> Stories ({stories.length})
                    </h2>
                    <div className="space-y-2">
                        {stories.map((story) => (
                            <div
                                key={story.id}
                                className="p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                                onClick={() => navigate({ to: '/stories/$id', params: { id: story.id } })}
                            >
                                <div className="font-medium text-sm">{story.title}</div>
                                {!!story.excerpt && <div className="text-xs text-muted-foreground mt-1">{story.excerpt}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {places.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <MapPin className="h-5 w-5" /> Places ({places.length})
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {places.map((place, idx) => (
                            <Badge key={idx} variant="secondary" className="text-sm py-1.5 px-3">
                                {place.location}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
