import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { sexColor } from '@/shared/lib/sexColors';

export interface FocalPickerNode {
    id: string;
    label: string;
    sex?: string;
    birthYear?: number | null;
}

interface FocalPersonPickerProps {
    /** All people available for selection (typically from useGraphData). */
    nodes: FocalPickerNode[];
    /** Currently selected focal person id, or null. */
    value: string | null;
    /** Called with a node id to set the focal, or null to clear. */
    onChange: (id: string | null) => void;
    /** Optional placeholder text. */
    placeholder?: string;
    /** Max items shown in the dropdown. Defaults to 8. */
    limit?: number;
}

/** Inline search-and-pick combobox for the focal person. Shared between the
 *  Graph dashboard and the Map view so the picker UX (and selection state, via
 *  focalStore) is identical across pages. */
export function FocalPersonPicker({
    nodes,
    value,
    onChange,
    placeholder = 'Focal person…',
    limit = 8,
}: FocalPersonPickerProps) {
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedLabel = useMemo(() => {
        if (!value) return '';
        return nodes.find((n) => n.id === value)?.label ?? '';
    }, [nodes, value]);

    const dropdownNodes = useMemo<FocalPickerNode[]>(() => {
        if (!focused) return [];
        const q = query.trim().toLowerCase();
        if (!q) return nodes.slice(0, limit);
        const words = q.split(/\s+/).filter(Boolean);
        return nodes
            .filter((n) => {
                const label = n.label.toLowerCase();
                return words.every((w) => label.includes(w));
            })
            .slice(0, limit);
    }, [focused, query, nodes, limit]);

    // Click-outside to close.
    useEffect(() => {
        function onMouseDown(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setFocused(false);
                setActiveIndex(-1);
            }
        }
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, []);

    function handleSelect(id: string | null) {
        onChange(id);
        setQuery('');
        setFocused(false);
        setActiveIndex(-1);
    }

    return (
        <div ref={containerRef} className="relative">
            <div className="flex items-center gap-1 h-8 rounded-md border border-input bg-background px-2 ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                    type="text"
                    value={focused ? query : selectedLabel}
                    onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); }}
                    onFocus={() => { setFocused(true); setQuery(''); setActiveIndex(-1); }}
                    onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setActiveIndex((i) => Math.min(i + 1, dropdownNodes.length - 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setActiveIndex((i) => Math.max(i - 1, 0));
                        } else if (e.key === 'Enter' && activeIndex >= 0) {
                            e.preventDefault();
                            handleSelect(dropdownNodes[activeIndex].id);
                        } else if (e.key === 'Escape') {
                            setFocused(false);
                            setActiveIndex(-1);
                        }
                    }}
                    placeholder={placeholder}
                    className="w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
                {value && !focused && (
                    <button
                        type="button"
                        onClick={() => handleSelect(null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Clear focal person"
                    >
                        <X className="h-3 w-3" />
                    </button>
                )}
            </div>
            {focused && dropdownNodes.length > 0 && (
                <div className="absolute left-0 top-full mt-1.5 w-56 z-50 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                    {dropdownNodes.map((node, i) => (
                        <button
                            key={node.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); handleSelect(node.id); }}
                            onMouseEnter={() => setActiveIndex(i)}
                            className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${
                                i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/40'
                            }`}
                        >
                            <span
                                className="inline-block w-2 h-2 rounded-full shrink-0"
                                style={{ background: sexColor(node.sex ?? 'U') }}
                            />
                            <span className="flex-1 min-w-0 truncate">{node.label}</span>
                            {node.birthYear && (
                                <span className="font-mono shrink-0 opacity-60">b.&nbsp;{node.birthYear}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
