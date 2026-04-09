import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { usePlacesSearch } from '@/api/hooks';
import type { Place } from '@/api/people';

export interface PlaceSearchComboboxProps {
    value: string;
    onChange: (query: string) => void;
    onSelect?: (place: Place) => void;
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
    debounceMs = 350,
    placeholder = 'City, Country',
    inputClassName = 'h-8 text-sm',
    dropdownClassName = 'w-full',
    size = 'default',
    autoFocus,
}: PlaceSearchComboboxProps) {
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(value), debounceMs);
        return () => clearTimeout(t);
    }, [value, debounceMs]);

    const { data: places } = usePlacesSearch(debouncedQuery);

    const handleSelect = (place: Place) => {
        onChange(place.name);
        setSelectedPlace(place);
        onSelect?.(place);
        setShowDropdown(false);
    };

    const handleChange = (query: string) => {
        onChange(query);
        setSelectedPlace(null);
        setShowDropdown(true);
    };

    const displayLat = selectedPlace?.lat != null
        ? `${Math.abs(selectedPlace.lat).toFixed(2)}°${selectedPlace.lat >= 0 ? 'N' : 'S'}, ${Math.abs(selectedPlace.lng ?? 0).toFixed(2)}°${(selectedPlace.lng ?? 0) >= 0 ? 'E' : 'W'}`
        : null;

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
                    className={inputClassName}
                    autoFocus={autoFocus}
                />
                {showDropdown && debouncedQuery.length >= 2 && (places ?? []).length > 0 && (
                    <div className={`absolute z-50 mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto ${dropdownClassName}`}>
                        {(places ?? []).map((place, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`w-full flex items-center gap-2 px-3 py-2 ${itemTextClass} hover:bg-muted/50 text-left`}
                                onMouseDown={() => handleSelect(place)}
                            >
                                <span className="truncate flex-1">
                                    {place.name}
                                    {!!place.admin2Name && place.admin2Name !== place.name && (
                                        <span className="text-muted-foreground">, {place.admin2Name}</span>
                                    )}
                                    {!!place.admin1Name && (
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
