import { useState, useEffect, useCallback } from 'react';
import { useUpdatePerson } from '@/api/hooks';
import { useSearch } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
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
}

// Debounced person search combobox
function PersonSearchCombobox({
    value,
    onChange,
    placeholder = 'Search people...',
}: {
    value: string;
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

    const people = (searchResults?.people ?? []) as Array<{ id: string; name: string }>;

    const handleSelect = (id: string) => {
        onChange(id);
        const found = people.find((p) => p.id === id);
        setQuery(found?.name || id);
        setShowDropdown(false);
    };

    return (
        <div className="relative">
            <Input
                placeholder={placeholder}
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                className="h-8 text-sm"
            />
            {value && !showDropdown && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">{value}</p>
            )}
            {showDropdown && debouncedQuery && people.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {people.map((p) => {
                        const parts = p.name.split(' ');
                        const first = parts[0] ?? '';
                        const last = parts.slice(1).join(' ') ?? '';
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                                onMouseDown={() => handleSelect(p.id)}
                            >
                                <CustomAvatar firstName={first} lastName={last} className="h-5 w-5 text-[9px]" />
                                <span className="truncate">{p.name || p.id}</span>
                                <span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">{p.id}</span>
                            </button>
                        );
                    })}
                </div>
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
}: EventEditorDialogProps) {
    const isEdit = existingEventIndex !== undefined && existingEvent !== undefined;

    const [eventType, setEventType] = useState<EventType>(
        (existingEvent?.type as EventType) ?? 'birth'
    );
    const [date, setDate] = useState((existingEvent?.date as string) ?? '');
    const [sortDate, setSortDate] = useState((existingEvent?.sort_date as string) ?? '');
    const [location, setLocation] = useState((existingEvent?.location as string) ?? '');
    const [description, setDescription] = useState((existingEvent?.description as string) ?? '');
    const [partnerId, setPartnerId] = useState((existingEvent?.partner_id as string) ?? '');
    const [marriageStatus, setMarriageStatus] = useState(
        (existingEvent?.status as string) ?? 'married'
    );
    const [cause, setCause] = useState((existingEvent?.cause as string) ?? '');
    const [title, setTitle] = useState((existingEvent?.title as string) ?? '');
    const [organization, setOrganization] = useState(
        (existingEvent?.organization as string) ?? ''
    );
    const [institution, setInstitution] = useState(
        (existingEvent?.institution as string) ?? ''
    );
    const [degree, setDegree] = useState((existingEvent?.degree as string) ?? '');
    const [householdId, setHouseholdId] = useState(
        (existingEvent?.household_id as string) ?? ''
    );

    // Reset when dialog opens with new event data
    useEffect(() => {
        if (isOpen) {
            setEventType((existingEvent?.type as EventType) ?? 'birth');
            setDate((existingEvent?.date as string) ?? '');
            setSortDate((existingEvent?.sort_date as string) ?? '');
            setLocation((existingEvent?.location as string) ?? '');
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
    }, [isOpen, existingEvent]);

    const updatePerson = useUpdatePerson();

    const buildEvent = useCallback((): Record<string, unknown> => {
        const base: Record<string, unknown> = { type: eventType };
        if (date) base.date = date;
        if (sortDate) base.sort_date = sortDate;
        if (location) base.location = location;
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
        eventType, date, sortDate, location, description,
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
                onSuccess: () => {
                    toast.success(isEdit ? 'Event updated.' : 'Event added.');
                    onClose();
                },
                onError: () => {
                    toast.error('Failed to save event.');
                },
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

                    {/* Common fields */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Date</label>
                            <Input
                                placeholder="e.g. 15 Mar 1920"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Sort Date (ISO)</label>
                            <Input
                                placeholder="yyyy-mm-dd"
                                value={sortDate}
                                onChange={(e) => setSortDate(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Location</label>
                        <Input
                            placeholder="City, Country"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="h-8 text-sm"
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
                            <PersonSearchCombobox value={partnerId} onChange={setPartnerId} />
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
                    <Button variant="outline" onClick={onClose} size="sm">
                        Cancel
                    </Button>
                    <Button onClick={handleSave} size="sm" disabled={updatePerson.isPending}>
                        {updatePerson.isPending ? 'Saving…' : isEdit ? 'Update' : 'Add Event'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
