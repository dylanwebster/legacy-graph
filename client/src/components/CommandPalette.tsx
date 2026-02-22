import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useUIStore } from '@/store/uiStore';
import { useSearch } from '@/api/hooks';
import { CustomAvatar } from './CustomAvatar';
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandSeparator,
} from '@/components/ui/command';
import { Users, BookOpen, MapPin, ArrowRight } from 'lucide-react';

function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debouncedValue;
}

export function CommandPalette() {
    const { searchOpen, setSearchOpen } = useUIStore();
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebounce(query, 300);
    const navigate = useNavigate();

    const { data, isLoading } = useSearch(debouncedQuery, { limit: 20 });

    // Global hotkey: Cmd+K / Ctrl+K
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setSearchOpen(!searchOpen);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchOpen, setSearchOpen]);

    const handleSelect = useCallback(
        (id: string) => {
            setSearchOpen(false);
            setQuery('');
            navigate({ to: '/people/$id', params: { id } });
        },
        [navigate, setSearchOpen]
    );

    const handleViewAll = useCallback(() => {
        if (!debouncedQuery) return;
        setSearchOpen(false);
        const q = debouncedQuery;
        setQuery('');
        navigate({ to: '/search', search: { q } });
    }, [debouncedQuery, navigate, setSearchOpen]);

    // Extract result categories from the search response
    const people = data?.results?.filter((r: Record<string, unknown>) => r.type === 'person') ?? [];
    const stories = data?.results?.filter((r: Record<string, unknown>) => r.type === 'story') ?? [];
    const places = data?.results?.filter((r: Record<string, unknown>) => r.type === 'place') ?? [];

    return (
        <CommandDialog
            open={searchOpen}
            onOpenChange={(open) => {
                setSearchOpen(open);
                if (!open) setQuery('');
            }}
            title="Search"
            description="Search for people, stories, and places"
            showCloseButton={false}
        >
            <CommandInput
                placeholder="Search people, stories, places..."
                value={query}
                onValueChange={setQuery}
            />
            <CommandList>
                {!debouncedQuery && (
                    <CommandEmpty>Start typing to search...</CommandEmpty>
                )}
                {debouncedQuery && !isLoading && people.length === 0 && stories.length === 0 && places.length === 0 && (
                    <CommandEmpty>No results found for "{debouncedQuery}"</CommandEmpty>
                )}
                {isLoading && debouncedQuery && (
                    <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>
                )}

                {people.length > 0 && (
                    <CommandGroup heading="People">
                        {people.map((person: Record<string, unknown>) => (
                            <CommandItem
                                key={person.id as string}
                                value={`person-${person.id}`}
                                onSelect={() => handleSelect(person.id as string)}
                                className="flex items-center gap-3 py-2"
                            >
                                <CustomAvatar
                                    firstName={(person.name as string)?.split(' ')[0]}
                                    lastName={(person.name as string)?.split(' ').slice(-1)[0]}
                                    className="h-8 w-8"
                                />
                                <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate">{person.name as string}</span>
                                    {person.snippet && (
                                        <span className="text-xs text-muted-foreground truncate">{String(person.snippet)}</span>
                                    )}
                                </div>
                                <Users className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}

                {stories.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Stories">
                            {stories.map((story: Record<string, unknown>) => (
                                <CommandItem
                                    key={story.id as string}
                                    value={`story-${story.id}`}
                                    onSelect={() => handleSelect(story.id as string)}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate">{story.name as string}</span>
                                        {story.snippet && (
                                            <span className="text-xs text-muted-foreground truncate">{String(story.snippet)}</span>
                                        )}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}

                {places.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Places">
                            {places.map((place: Record<string, unknown>, idx: number) => (
                                <CommandItem
                                    key={`place-${idx}`}
                                    value={`place-${place.name}`}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <span className="font-medium truncate">{place.name as string}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}

                {debouncedQuery && !isLoading && (people.length > 0 || stories.length > 0 || places.length > 0) && (
                    <>
                        <CommandSeparator />
                        <CommandGroup>
                            <CommandItem
                                onSelect={handleViewAll}
                                className="flex items-center justify-center gap-2 py-2 text-muted-foreground"
                            >
                                <ArrowRight className="h-4 w-4" />
                                <span>View all results for "{debouncedQuery}"</span>
                            </CommandItem>
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </CommandDialog>
    );
}
