import { useState, useEffect, useRef } from 'react';
import { useSearch } from '@/shared/api/hooks';
import { Input } from '@/shared/ui/input';
import { CustomAvatar } from '@/shared/components/CustomAvatar';

interface PersonSearchComboboxProps {
    onSelect: (id: string, name: string) => void;
    excludeIds?: string[];
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
}

type PersonResult = {
    id: string;
    names?: Array<{ first?: string; given?: string; last?: string; surname?: string }>;
    birthDate?: string;
    sex?: string;
};

function getDisplayName(p: PersonResult): string {
    const n = p.names?.[0];
    return `${n?.first || n?.given || ''} ${n?.last || n?.surname || ''}`.trim() || p.id;
}

function getBirthYear(p: PersonResult): string | null {
    if (!p.birthDate) return null;
    const m = p.birthDate.match(/\d{4}/);
    return m ? m[0] : null;
}

export function PersonSearchCombobox({
    onSelect,
    excludeIds = [],
    placeholder = 'Search people…',
    className,
    autoFocus,
}: PersonSearchComboboxProps) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    // Reset active index when results change
    useEffect(() => {
        setActiveIndex(-1);
    }, [debouncedQuery]);

    const { data: searchResults } = useSearch(debouncedQuery, { limit: 8 });
    const people = ((searchResults?.people ?? []) as PersonResult[]).filter(
        (p) => !excludeIds.includes(p.id)
    );

    const handleSelect = (p: PersonResult) => {
        onSelect(p.id, getDisplayName(p));
        setQuery('');
        setOpen(false);
        setActiveIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || people.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, people.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            handleSelect(people[activeIndex]);
        } else if (e.key === 'Escape') {
            setOpen(false);
            setActiveIndex(-1);
        }
    };

    return (
        <div className={`relative ${className ?? ''}`}>
            <Input
                placeholder={placeholder}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(-1); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                autoFocus={autoFocus}
            />
            {open && debouncedQuery && people.length > 0 && (
                <div
                    ref={listRef}
                    className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto"
                >
                    {people.map((p, i) => {
                        const name = getDisplayName(p);
                        const year = getBirthYear(p);
                        const firstName = p.names?.[0]?.first || p.names?.[0]?.given || '';
                        const lastName = p.names?.[0]?.last || p.names?.[0]?.surname || '';
                        const isActive = i === activeIndex;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left transition-colors ${
                                    isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                                }`}
                                onMouseDown={() => handleSelect(p)}
                                onMouseEnter={() => setActiveIndex(i)}
                            >
                                <CustomAvatar
                                    firstName={firstName}
                                    lastName={lastName}
                                    className="h-6 w-6 text-[10px] shrink-0"
                                    sex={p.sex}
                                />
                                <span className="flex-1 truncate">{name}</span>
                                {year && (
                                    <span className="text-xs text-muted-foreground shrink-0">b. {year}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
