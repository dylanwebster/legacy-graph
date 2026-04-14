import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { usePlacesSearch } from '@/api/hooks';
import type { Place } from '@/api/people';
import { formatPlaceDisplay, formatCoordinates } from '@/lib/placeUtils';

export interface PlaceSearchComboboxProps {
    value: string;
    onChange: (query: string) => void;
    onSelect?: (place: Place) => void;
    /** Called when the user presses Escape with no dropdown visible, signalling intent to dismiss the combobox entirely */
    onDismiss?: () => void;
    /** Pre-populate with an existing Place so coordinates show immediately */
    initialPlace?: Place | null;
    /** Debounce delay in ms (default 350) */
    debounceMs?: number;
    /** Input placeholder (default "City, Country") */
    placeholder?: string;
    /** Input className override */
    inputClassName?: string;
    /** Dropdown width className (default "w-full") */
    dropdownClassName?: string;
    /** Size variant: 'sm' uses smaller text/padding, 'default' uses standard */
    size?: 'sm' | 'default';
    /** Auto-focus the input */
    autoFocus?: boolean;
}

export function PlaceSearchCombobox({
    value,
    onChange,
    onSelect,
    onDismiss,
    initialPlace,
    debounceMs = 350,
    placeholder = 'City, Country',
    inputClassName = 'h-8 text-sm',
    dropdownClassName = 'w-full',
    size = 'default',
    autoFocus,
}: PlaceSearchComboboxProps) {
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(initialPlace ?? null);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const listRef = useRef<HTMLDivElement>(null);

    // Sync when parent provides a new initial place (e.g. dialog reopened with different event)
    useEffect(() => {
        setSelectedPlace(initialPlace ?? null);
    }, [initialPlace]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(value), debounceMs);
        return () => clearTimeout(t);
    }, [value, debounceMs]);

    const { data: places } = usePlacesSearch(debouncedQuery);
    const visiblePlaces = useMemo(
        () => showDropdown && debouncedQuery.length >= 2 ? (places ?? []) : [],
        [showDropdown, debouncedQuery, places],
    );

    // Reset highlight when results change
    useEffect(() => {
        setHighlightIndex(-1);
    }, [places]);

    const handleSelect = useCallback((place: Place) => {
        onChange(formatPlaceDisplay(place));
        setSelectedPlace(place);
        onSelect?.(place);
        setShowDropdown(false);
        setHighlightIndex(-1);
    }, [onChange, onSelect]);

    const handleChange = (query: string) => {
        onChange(query);
        setSelectedPlace(null);
        setShowDropdown(true);
        setHighlightIndex(-1);
    };

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (visiblePlaces.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIndex(i => (i + 1) % visiblePlaces.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex(i => (i <= 0 ? visiblePlaces.length - 1 : i - 1));
            } else if (e.key === 'Enter' && highlightIndex >= 0) {
                e.preventDefault();
                handleSelect(visiblePlaces[highlightIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setShowDropdown(false);
                setHighlightIndex(-1);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDismiss?.();
        }
    }, [visiblePlaces, highlightIndex, handleSelect, onDismiss]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightIndex >= 0 && listRef.current) {
            const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
            item?.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightIndex]);

    const displayLat = formatCoordinates(selectedPlace);

    const itemTextClass = size === 'sm' ? 'text-xs' : 'text-sm';
    const coordClass = size === 'sm'
        ? 'text-[10px] text-green-600 dark:text-green-400 mt-0.5'
        : 'text-xs text-green-600 dark:text-green-400 mt-1';

    return (
        <>
            <div className="relative">
                <Input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    onKeyDown={handleKeyDown}
                    className={inputClassName}
                    autoFocus={autoFocus}
                />
                {visiblePlaces.length > 0 && (
                    <div
                        ref={listRef}
                        className={`absolute z-50 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-auto ring-1 ring-border/50 ${dropdownClassName}`}
                    >
                        {visiblePlaces.map((place, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`w-full flex items-center gap-2 px-3 py-2 ${itemTextClass} text-left transition-colors ${i === highlightIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'}`}
                                onMouseDown={() => handleSelect(place)}
                                onMouseEnter={() => setHighlightIndex(i)}
                            >
                                <span className="truncate flex-1">
                                    {place.name}
                                    {!!place.admin2Name && place.admin2Name !== place.name && (
                                        <span className="text-muted-foreground">, {place.admin2Name}</span>
                                    )}
                                    {!!place.admin1Name && place.admin1Name !== place.name && (
                                        <span className="text-muted-foreground">, {place.admin1Name}</span>
                                    )}
                                </span>
                                {!!place.countryCode && (
                                    <span className="text-xs text-muted-foreground shrink-0">{place.countryCode}</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {!!displayLat && <p className={coordClass}>{displayLat}</p>}
        </>
    );
}
