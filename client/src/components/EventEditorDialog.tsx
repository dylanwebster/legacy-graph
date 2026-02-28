import { useState, useEffect, useCallback } from 'react';
import { useUpdatePerson, useSearch, usePlacesSearch } from '@/api/hooks';
import type { Place } from '@/api/people';
import { CustomAvatar } from '@/components/CustomAvatar';
import { SmartDateInput, parseToISO } from '@/components/SmartDateInput';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const EVENT_TYPES = [
    'birth', 'death', 'marriage', 'divorce', 'residence',
    'census', 'occupation', 'education', 'baptism', 'burial', 'generic',
] as const;
type EventType = typeof EVENT_TYPES[number];

interface EventEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    personId: string;
    existingEvent?: Record<string, unknown>;
    existingEventIndex?: number;
    currentEvents: Array<Record<string, unknown>>;
    initialEventType?: EventType;
}

// Debounced person search combobox
function PersonSearchCombobox({
    onChange,
    placeholder = 'Search people...',
}: {
    onChange: (id: string) => void;
    placeholder?: string;
}) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const { data: searchResults } = useSearch(debouncedQuery, { limit: 8 });
    // Search API enriches results with `names: PersonName[]` and `birthDate`, not `name: string`
    const people = (searchResults?.people ?? []) as Array<{ id: string; names?: Array<{ first?: string; given?: string; last?: string; surname?: string }>; birthDate?: string }>;

    const handleSelect = (id: string, displayName?: string) => {
        onChange(id);
        setQuery(displayName ?? id);
        setShowDropdown(false);
    };

    return (
        <div className="relative">
            <Input
                placeholder={placeholder}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                className="h-8 text-sm"
            />
            {showDropdown && debouncedQuery && people.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {people.map((p) => {
                        const primaryName = p.names?.[0];
                        const first = primaryName?.first || primaryName?.given || '';
                        const last = primaryName?.last || primaryName?.surname || '';
                        const displayName = `${first} ${last}`.trim() || p.id;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                                onMouseDown={() => handleSelect(p.id, displayName)}
                            >
                                <CustomAvatar firstName={first} lastName={last} className="h-5 w-5 text-[9px]" />
                                <span className="truncate flex-1">{displayName}</span>
                                {!!p.birthDate && (
                                    <span className="text-xs text-muted-foreground shrink-0">b. {p.birthDate}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// Debounced place search combobox
function PlaceSearchCombobox({
    value,
    onChange,
    onSelect,
}: {
    value: string;
    onChange: (query: string) => void;
    onSelect: (place: Place) => void;
}) {
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(value), 350);
        return () => clearTimeout(t);
    }, [value]);

    const { data: places } = usePlacesSearch(debouncedQuery);

    const handleSelect = (place: Place) => {
        onChange(place.name);
        setSelectedPlace(place);
        onSelect(place);
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

    return (
        <div className="relative">
            <Input
                placeholder="City, Country"
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                className="h-8 text-sm"
            />
            {showDropdown && debouncedQuery.length >= 2 && (places ?? []).length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {(places ?? []).map((place, i) => (
                        <button
                            key={i}
                            type="button"
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                            onMouseDown={() => handleSelect(place)}
                        >
                            <span className="truncate flex-1">{place.name}</span>
                            {!!place.countryCode && (
                                <span className="text-xs text-muted-foreground shrink-0">{place.countryCode}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}
            {!!displayLat && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">{displayLat}</p>
            )}
        </div>
    );
}

function getRequiredFields(type: EventType): string[] {
    switch (type) {
        case 'marriage':
        case 'divorce':
            return ['partner_id'];
        case 'occupation':
            return ['title'];
        case 'education':
            return ['institution'];
        default:
            return [];
    }
}

export function EventEditorDialog({
    isOpen,
    onClose,
    personId,
    existingEvent,
    existingEventIndex,
    currentEvents,
    initialEventType,
}: EventEditorDialogProps) {
    const isEdit = existingEventIndex !== undefined && existingEvent !== undefined;

    const [eventType, setEventType] = useState<EventType>(
        (existingEvent?.type as EventType) ?? initialEventType ?? 'birth'
    );
    const [date, setDate] = useState((existingEvent?.date as string) ?? '');
    const [locationQuery, setLocationQuery] = useState(() => {
        const loc = existingEvent?.location;
        if (!loc) return '';
        if (typeof loc === 'object' && loc !== null && 'name' in loc) return (loc as Place).name;
        if (typeof loc === 'string') return loc;
        return '';
    });
    const [locationPlace, setLocationPlace] = useState<Place | null>(() => {
        const loc = existingEvent?.location;
        if (loc && typeof loc === 'object' && 'name' in loc) return loc as Place;
        return null;
    });
    const [description, setDescription] = useState((existingEvent?.description as string) ?? '');
    const [partnerId, setPartnerId] = useState((existingEvent?.partner_id as string) ?? '');
    const [marriageStatus, setMarriageStatus] = useState(
        (existingEvent?.status as string) ?? 'married'
    );
    const [cause, setCause] = useState((existingEvent?.cause as string) ?? '');
    const [title, setTitle] = useState((existingEvent?.title as string) ?? '');
    const [organization, setOrganization] = useState((existingEvent?.organization as string) ?? '');
    const [institution, setInstitution] = useState((existingEvent?.institution as string) ?? '');
    const [degree, setDegree] = useState((existingEvent?.degree as string) ?? '');
    const [householdId, setHouseholdId] = useState((existingEvent?.household_id as string) ?? '');

    // Reset when dialog opens with new event data
    useEffect(() => {
        if (isOpen) {
            setEventType((existingEvent?.type as EventType) ?? initialEventType ?? 'birth');
            setDate((existingEvent?.date as string) ?? '');
            const loc = existingEvent?.location;
            if (loc && typeof loc === 'object' && 'name' in loc) {
                setLocationQuery((loc as Place).name);
                setLocationPlace(loc as Place);
            } else if (typeof loc === 'string') {
                setLocationQuery(loc);
                setLocationPlace(null);
            } else {
                setLocationQuery('');
                setLocationPlace(null);
            }
            setDescription((existingEvent?.description as string) ?? '');
            setPartnerId((existingEvent?.partner_id as string) ?? '');
            setMarriageStatus((existingEvent?.status as string) ?? 'married');
            setCause((existingEvent?.cause as string) ?? '');
            setTitle((existingEvent?.title as string) ?? '');
            setOrganization((existingEvent?.organization as string) ?? '');
            setInstitution((existingEvent?.institution as string) ?? '');
            setDegree((existingEvent?.degree as string) ?? '');
            setHouseholdId((existingEvent?.household_id as string) ?? '');
        }
    }, [isOpen, existingEvent, initialEventType]);

    const updatePerson = useUpdatePerson();

    const buildEvent = useCallback((): Record<string, unknown> => {
        const base: Record<string, unknown> = { type: eventType };
        if (date) {
            base.date = date;
            const iso = parseToISO(date);
            if (iso) base.sort_date = iso;
        }
        if (locationPlace) {
            base.location = locationPlace;
        } else if (locationQuery.trim()) {
            base.location = { name: locationQuery.trim() };
        }
        if (description) base.description = description;

        switch (eventType) {
            case 'marriage':
                base.partner_id = partnerId;
                base.status = marriageStatus;
                break;
            case 'divorce':
                base.partner_id = partnerId;
                break;
            case 'death':
                if (cause) base.cause = cause;
                break;
            case 'occupation':
                base.title = title;
                if (organization) base.organization = organization;
                break;
            case 'education':
                base.institution = institution;
                if (degree) base.degree = degree;
                break;
            case 'census':
                if (householdId) base.household_id = householdId;
                break;
            case 'generic':
                if (title) base.title = title;
                break;
        }
        return base;
    }, [
        eventType, date, locationPlace, locationQuery, description,
        partnerId, marriageStatus, cause, title, organization,
        institution, degree, householdId,
    ]);

    const handleSave = () => {
        const required = getRequiredFields(eventType);
        const eventData: Record<string, string | undefined> = {
            partner_id: partnerId, title, institution,
        };
        for (const field of required) {
            if (!eventData[field]) {
                toast.error(`"${field}" is required for ${eventType} events.`);
                return;
            }
        }

        const newEvent = buildEvent();
        let updatedEvents: Array<Record<string, unknown>>;
        if (isEdit) {
            updatedEvents = currentEvents.map((e, i) => (i === existingEventIndex ? newEvent : e));
        } else {
            updatedEvents = [...currentEvents, newEvent];
        }

        updatePerson.mutate(
            { id: personId, updates: { events: updatedEvents } },
            {
                onSuccess: () => { toast.success(isEdit ? 'Event updated.' : 'Event added.'); onClose(); },
                onError: () => toast.error('Failed to save event.'),
            }
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Event' : 'Add Event'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Event type */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Event Type
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                            {EVENT_TYPES.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setEventType(t)}
                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                        eventType === t
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Date — single smart input */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Date</label>
                        <SmartDateInput
                            value={date}
                            onChange={(val) => setDate(val)}
                            placeholder="e.g. 15 Jun 1920 or 1920 or abt 1920"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Location</label>
                        <PlaceSearchCombobox
                            value={locationQuery}
                            onChange={setLocationQuery}
                            onSelect={setLocationPlace}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Description</label>
                        <textarea
                            placeholder="Optional notes..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                            className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] resize-none"
                        />
                    </div>

                    {/* Type-specific fields */}
                    {(eventType === 'marriage' || eventType === 'divorce') && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">
                                Partner <span className="text-destructive">*</span>
                            </label>
                            <PersonSearchCombobox onChange={setPartnerId} />
                        </div>
                    )}

                    {eventType === 'marriage' && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Status</label>
                            <div className="flex gap-2">
                                {['married', 'divorced', 'widowed'].map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setMarriageStatus(s)}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                            marriageStatus === s
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {eventType === 'death' && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Cause</label>
                            <Input
                                placeholder="Cause of death"
                                value={cause}
                                onChange={(e) => setCause(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                    )}

                    {(eventType === 'occupation' || eventType === 'generic') && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">
                                Title {eventType === 'occupation' && <span className="text-destructive">*</span>}
                            </label>
                            <Input
                                placeholder={eventType === 'occupation' ? 'Job title' : 'Event title'}
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                    )}

                    {eventType === 'occupation' && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Organization</label>
                            <Input
                                placeholder="Employer / organization"
                                value={organization}
                                onChange={(e) => setOrganization(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                    )}

                    {eventType === 'education' && (
                        <>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">
                                    Institution <span className="text-destructive">*</span>
                                </label>
                                <Input
                                    placeholder="School / university"
                                    value={institution}
                                    onChange={(e) => setInstitution(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">Degree</label>
                                <Input
                                    placeholder="e.g. B.Sc. Computer Science"
                                    value={degree}
                                    onChange={(e) => setDegree(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </>
                    )}

                    {eventType === 'census' && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Household ID</label>
                            <Input
                                placeholder="Census household ID"
                                value={householdId}
                                onChange={(e) => setHouseholdId(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                    <Button
                        onClick={handleSave}
                        size="sm"
                        disabled={updatePerson.isPending || (!!date.trim() && parseToISO(date) === null)}
                        title={!!date.trim() && parseToISO(date) === null ? 'Fix the date before saving' : undefined}
                    >
                        {updatePerson.isPending ? 'Saving…' : isEdit ? 'Update' : 'Add Event'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
