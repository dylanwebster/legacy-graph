import { useState, useEffect } from 'react';
import { useSearch } from '@/api/hooks';
import { Input } from '@/components/ui/input';
import { CustomAvatar } from '@/components/CustomAvatar';

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
    events?: Array<{ type: string; date?: string }>;
};

function getDisplayName(p: PersonResult): string {
    const n = p.names?.[0];
    return `${n?.first || n?.given || ''} ${n?.last || n?.surname || ''}`.trim() || p.id;
}

function getBirthYear(p: PersonResult): string | null {
    const birth = p.events?.find((e) => e.type === 'birth');
    if (!birth?.date) return null;
    const m = birth.date.match(/\d{4}/);
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

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const { data: searchResults } = useSearch(debouncedQuery, { limit: 8 });
    const people = ((searchResults?.people ?? []) as PersonResult[]).filter(
        (p) => !excludeIds.includes(p.id)
    );

    return (
        <div className={`relative ${className ?? ''}`}>
            <Input
                placeholder={placeholder}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                className="h-8 text-sm"
                autoFocus={autoFocus}
            />
            {open && debouncedQuery && people.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {people.map((p) => {
                        const name = getDisplayName(p);
                        const year = getBirthYear(p);
                        const firstName = p.names?.[0]?.first || p.names?.[0]?.given || '';
                        const lastName = p.names?.[0]?.last || p.names?.[0]?.surname || '';
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted text-left"
                                onMouseDown={() => {
                                    onSelect(p.id, name);
                                    setQuery('');
                                    setOpen(false);
                                }}
                            >
                                <CustomAvatar
                                    firstName={firstName}
                                    lastName={lastName}
                                    className="h-6 w-6 text-[10px] shrink-0"
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
