import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useUIStore } from '@/shared/store/uiStore';
import { useSearch } from '@/shared/api/hooks';
import type { PlaceResult } from '@/shared/api/hooks';
import type { SlimPersonSummary } from '@/shared/api/people';
import type { StoryFeedItem } from '@/shared/api/stories';
import { CustomAvatar } from '@/shared/components/CustomAvatar';
import {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandSeparator,
} from '@/shared/ui/command';
import { Users, BookOpen, MapPin, ArrowRight, Globe } from 'lucide-react';
import { useFocalStore } from '@/shared/store/focalStore';

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
    const focalPersonId = useFocalStore((s) => s.focalPersonId);

    const { data, isLoading } = useSearch(debouncedQuery, { limit: 20 });

    // Global hotkey: "/" — only when not in a text input/textarea/contenteditable
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== '/') return;
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable ||
                !!target.closest('[contenteditable="true"]')
            ) return;
            e.preventDefault();
            setSearchOpen(true);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [setSearchOpen]);

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

    // Extract result categories from the search response { people, stories, places }
    const people: SlimPersonSummary[] = data?.people ?? [];
    const stories: StoryFeedItem[] = data?.stories ?? [];
    const places: PlaceResult[] = data?.places ?? [];

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
                    <>
                        <CommandGroup heading="Actions">
                            <CommandItem
                                value="action-view-map"
                                onSelect={() => {
                                    setSearchOpen(false);
                                    navigate({ to: '/map' });
                                }}
                                className="flex items-center gap-3 py-2"
                            >
                                <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
                                <span>View Map</span>
                            </CommandItem>
                            {focalPersonId && (
                                <CommandItem
                                    value="action-focal-on-map"
                                    onSelect={() => {
                                        setSearchOpen(false);
                                        navigate({ to: '/map', search: { scope: 'lineage', person: focalPersonId } });
                                    }}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <span>Show focal lineage on Map</span>
                                </CommandItem>
                            )}
                        </CommandGroup>
                        <CommandEmpty>Start typing to search…</CommandEmpty>
                    </>
                )}
                {debouncedQuery && !isLoading && people.length === 0 && stories.length === 0 && places.length === 0 && (
                    <CommandEmpty>No results found for "{debouncedQuery}"</CommandEmpty>
                )}
                {isLoading && debouncedQuery && (
                    <div className="py-6 text-center text-sm text-muted-foreground">Searching...</div>
                )}

                {people.length > 0 && (
                    <CommandGroup heading="People">
                        {people.map((person) => {
                            const n = person.names?.[0];
                            const firstName = n?.first ?? n?.given ?? '';
                            const lastName = n?.last ?? n?.surname ?? '';
                            const displayName = `${firstName} ${lastName}`.trim() || 'Unknown';
                            return (
                                <CommandItem
                                    key={person.id}
                                    value={`person-${person.id}-${displayName}`}
                                    onSelect={() => handleSelect(person.id)}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <CustomAvatar
                                        firstName={firstName}
                                        lastName={lastName}
                                        className="h-8 w-8"
                                        sex={person.sex}
                                    />
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate">{displayName}</span>
                                        {!!person.birthDate && (
                                            <span className="text-xs text-muted-foreground truncate">b. {person.birthDate}</span>
                                        )}
                                    </div>
                                    <Users className="ml-auto h-4 w-4 text-muted-foreground shrink-0" />
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>
                )}

                {stories.length > 0 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Stories">
                            {stories.map((story) => (
                                <CommandItem
                                    key={story.id}
                                    value={`story-${story.id}`}
                                    onSelect={handleViewAll}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium truncate">{story.title}</span>
                                        {!!story.excerpt && (
                                            <span className="text-xs text-muted-foreground truncate">{story.excerpt}</span>
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
                            {places.map((place, idx) => (
                                <CommandItem
                                    key={`place-${idx}`}
                                    value={`place-${place.location}`}
                                    className="flex items-center gap-3 py-2"
                                >
                                    <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
                                    <span className="font-medium truncate">{place.location}</span>
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
