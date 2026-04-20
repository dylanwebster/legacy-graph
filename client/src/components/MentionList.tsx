import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SlimPersonSummary } from '@/shared/api/people';

interface MentionListProps {
    items: SlimPersonSummary[];
    command: (item: SlimPersonSummary) => void;
}

export interface MentionListHandle {
    onKeyDown: (event: KeyboardEvent) => boolean;
}

function getDisplayName(person: SlimPersonSummary): string {
    const n = person.names?.[0];
    return [n?.first, n?.last].filter(Boolean).join(' ') || person.id;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
    ({ items, command }, ref) => {
        const [selectedIndex, setSelectedIndex] = useState(0);

        // Reset selection when items change
        useEffect(() => {
            setSelectedIndex(0);
        }, [items]);

        const selectItem = (index: number) => {
            const item = items[index];
            if (item) {
                command(item);
            }
        };

        useImperativeHandle(ref, () => ({
            onKeyDown: ({ key }: KeyboardEvent) => {
                if (key === 'ArrowUp') {
                    setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
                    return true;
                }
                if (key === 'ArrowDown') {
                    setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
                    return true;
                }
                if (key === 'Enter') {
                    selectItem(selectedIndex);
                    return true;
                }
                return false;
            },
        }));

        if (!items.length) {
            return (
                <div
                    data-mention-list
                    className="bg-popover border border-border rounded-md shadow-lg p-2 text-xs text-muted-foreground"
                >
                    No people found
                </div>
            );
        }

        return (
            <div
                data-mention-list
                className="bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[200px] max-h-48 overflow-y-auto"
            >
                {items.map((person, index) => (
                    <button
                        key={person.id}
                        type="button"
                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                            index === selectedIndex
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-muted text-foreground'
                        }`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            selectItem(index);
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                    >
                        <span className="font-medium flex-1">{getDisplayName(person)}</span>
                        {person.birthDate && (
                            <span className="text-muted-foreground text-[10px] shrink-0">
                                b. {person.birthDate.slice(0, 4)}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        );
    },
);

MentionList.displayName = 'MentionList';
