import { useRef, useState, useEffect } from 'react';
import { useSearch } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { CustomAvatar } from '@/components/CustomAvatar';
import { X, Search } from 'lucide-react';

export interface PersonChipData {
    id: string;
    name: string;
}

interface AssetSearchBarProps {
    textValue: string;
    onTextChange: (q: string) => void;
    selectedPeople: PersonChipData[];
    onAddPerson: (id: string, name: string) => void;
    onRemovePerson: (id: string) => void;
}

type PersonResult = {
    id: string;
    names?: Array<{ first?: string; given?: string; last?: string; surname?: string }>;
    birthDate?: string;
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

export function AssetSearchBar({
    textValue,
    onTextChange,
    selectedPeople,
    onAddPerson,
    onRemovePerson,
}: AssetSearchBarProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);

    // Extract @mention from the current text value
    const mentionMatch = /@(\S*)$/.exec(textValue);
    const currentMentionQuery = mentionMatch ? mentionMatch[1] : null;

    // Sync mentionQuery state with the detected mention
    useEffect(() => {
        setMentionQuery(currentMentionQuery);
        setActiveIndex(-1);
    }, [currentMentionQuery]);

    const excludeIds = selectedPeople.map((p) => p.id);

    const { data: searchResults } = useSearch(mentionQuery ?? '', { limit: 8 });
    const candidates: PersonResult[] = mentionQuery !== null
        ? ((searchResults?.people ?? []) as PersonResult[]).filter((p) => !excludeIds.includes(p.id))
        : [];

    const showDropdown = mentionQuery !== null && candidates.length > 0;

    const handleSelect = (p: PersonResult) => {
        const name = getDisplayName(p);
        // Strip the @<query> from text
        const newText = textValue.replace(/@\S*$/, '').trimEnd();
        onTextChange(newText);
        onAddPerson(p.id, name);
        setMentionQuery(null);
        setActiveIndex(-1);
        inputRef.current?.focus();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onTextChange(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setMentionQuery(null);
            return;
        }

        // Backspace on empty text with no mention removes last chip
        if (e.key === 'Backspace' && textValue === '' && selectedPeople.length > 0) {
            onRemovePerson(selectedPeople[selectedPeople.length - 1].id);
            return;
        }

        if (!showDropdown) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            handleSelect(candidates[activeIndex]);
        }
    };

    return (
        <div
            ref={containerRef}
            className="relative flex-1 max-w-xs"
            onClick={() => inputRef.current?.focus()}
        >
            <div className="flex items-center gap-1 flex-wrap h-8 px-2 rounded-md border border-input bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-text overflow-hidden">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

                {selectedPeople.map((p) => (
                    <Badge
                        key={p.id}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 h-5 gap-0.5 shrink-0"
                    >
                        <span className="max-w-[80px] truncate">{p.name}</span>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onRemovePerson(p.id); }}
                            className="ml-0.5 hover:text-destructive transition-colors"
                            aria-label={`Remove ${p.name}`}
                        >
                            <X className="h-2.5 w-2.5" />
                        </button>
                    </Badge>
                ))}

                <input
                    ref={inputRef}
                    type="text"
                    value={textValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={selectedPeople.length === 0 ? 'Search or @mention…' : '@mention…'}
                    className="flex-1 min-w-[60px] bg-transparent outline-none placeholder:text-muted-foreground text-xs"
                />
            </div>

            {/* @mention dropdown */}
            {showDropdown && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {candidates.map((p, i) => {
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
