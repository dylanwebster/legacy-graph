import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUpdatePerson, useSearch, useUploadEventMedia, useAssets, useDeleteGalleryAsset } from '@/shared/api/hooks';
import type { Place } from '@/shared/api/people';
import { CustomAvatar } from '@/shared/components/CustomAvatar';
import { SmartDateInput, parseToISO } from '@/components/SmartDateInput';
import { AssetPickerDialog } from '@/components/AssetPickerDialog';
import type { PersonChipData } from '@/components/AssetSearchBar';
import { AssetLightbox } from '@/components/AssetLightbox';
import { PlaceSearchCombobox } from '@/shared/components/PlaceSearchCombobox';
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import {
    Sunrise, Sunset, Heart, MapPin, GraduationCap, Briefcase, Church, Ship,
    ScrollText, Users, FileText, Calendar, Leaf, ChevronDown, Check,
    Link2, Trash2, Upload, X,
} from 'lucide-react';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/shared/ui/command';
import { assetType } from '@/shared/lib/assets';
import { formatPlaceDisplay } from '@/shared/lib/places';
import { toast } from 'sonner';

const EVENT_META = {
    birth:            { icon: Sunrise,       label: 'Birth' },
    death:            { icon: Sunset,        label: 'Death' },
    marriage:         { icon: Heart,         label: 'Marriage' },
    divorce:          { icon: Heart,         label: 'Divorce' },
    engagement:       { icon: Heart,         label: 'Engagement' },
    residence:        { icon: MapPin,        label: 'Residence' },
    census:           { icon: FileText,      label: 'Census' },
    occupation:       { icon: Briefcase,     label: 'Occupation' },
    education:        { icon: GraduationCap, label: 'Education' },
    military_service: { icon: ScrollText,    label: 'Military Service' },
    immigration:      { icon: Ship,          label: 'Immigration' },
    emigration:       { icon: Ship,          label: 'Emigration' },
    adoption:         { icon: Users,         label: 'Adoption' },
    baptism:          { icon: Church,        label: 'Baptism' },
    burial:           { icon: Leaf,          label: 'Burial' },
    generic:          { icon: Calendar,      label: 'Other' },
} satisfies Record<string, { icon: typeof Calendar; label: string }>;

type EventType = keyof typeof EVENT_META;

const EVENT_CATEGORIES: Array<{ label: string; types: EventType[] }> = [
    { label: 'Life',                types: ['birth', 'death', 'adoption', 'baptism', 'burial'] },
    { label: 'Family',             types: ['marriage', 'divorce', 'engagement'] },
    { label: 'Location',           types: ['residence', 'immigration', 'emigration'] },
    { label: 'Career & Education', types: ['occupation', 'education', 'military_service'] },
    { label: 'Records',            types: ['census', 'generic'] },
];

interface EventEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    personId: string;
    personChip?: PersonChipData;
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
    const people = (searchResults?.people ?? []) as Array<{ id: string; names?: Array<{ first?: string; given?: string; last?: string; surname?: string }>; birthDate?: string; sex?: string }>;

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
                                <CustomAvatar firstName={first} lastName={last} className="h-5 w-5 text-[9px]" sex={p.sex} />
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


// ── Event Type Selector ──────────────────────────────────────────────────────

function EventTypeSelector({ value, onChange }: { value: EventType; onChange: (t: EventType) => void }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const meta = EVENT_META[value];
    const Icon = meta.icon;

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md border border-input bg-transparent text-sm hover:bg-muted/50 transition-colors"
            >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left font-medium">{meta.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute z-50 w-full mt-1 rounded-md border border-border bg-popover shadow-md">
                    <Command className="rounded-md">
                        <CommandInput placeholder="Search event types..." className="h-8 text-sm" />
                        <CommandList className="max-h-56">
                            <CommandEmpty>No event type found.</CommandEmpty>
                            {EVENT_CATEGORIES.map((cat) => (
                                <CommandGroup key={cat.label} heading={cat.label}>
                                    {cat.types.map((t) => {
                                        const m = EVENT_META[t];
                                        const ItemIcon = m.icon;
                                        return (
                                            <CommandItem
                                                key={t}
                                                value={`${m.label} ${t}`}
                                                onSelect={() => { onChange(t); setOpen(false); }}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <ItemIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                <span className="flex-1">{m.label}</span>
                                                {t === value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                            ))}
                        </CommandList>
                    </Command>
                </div>
            )}
        </div>
    );
}

function getRequiredFields(type: EventType): string[] {
    switch (type) {
        case 'marriage':
        case 'divorce':
        case 'engagement':
            return ['partner_id'];
        case 'occupation':
            return ['title'];
        case 'education':
            return ['institution'];
        case 'military_service':
            return ['branch'];
        default:
            return [];
    }
}

// ── Main component ───────────────────────────────────────────────────────────

export function EventEditorDialog({
    isOpen,
    onClose,
    personId,
    personChip,
    existingEvent,
    existingEventIndex,
    currentEvents,
    initialEventType,
}: EventEditorDialogProps) {
    const isEdit = existingEventIndex !== undefined && existingEvent !== undefined;

    const [eventAssets, setEventAssets] = useState<string[]>((existingEvent?.assets as string[]) ?? []);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [lightboxFile, setLightboxFile] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteAssetTarget, setDeleteAssetTarget] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadEventMedia = useUploadEventMedia();
    const deleteGalleryAsset = useDeleteGalleryAsset();

    // All known assets for stale-asset guard in the gallery
    const { data: allAssetsData } = useAssets();
    const assetSet = new Set((allAssetsData?.assets ?? []).map(a => a.filename));

    const [eventType, setEventType] = useState<EventType>(
        (existingEvent?.type as EventType) ?? initialEventType ?? 'birth'
    );
    const [date, setDate] = useState((existingEvent?.date as string) ?? '');
    const [locationQuery, setLocationQuery] = useState(() => {
        const loc = existingEvent?.location;
        if (!loc) return '';
        if (typeof loc === 'object' && loc !== null && 'name' in loc) return formatPlaceDisplay(loc as Place);
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
    const [branch, setBranch] = useState((existingEvent?.branch as string) ?? '');
    const [rank, setRank] = useState((existingEvent?.rank as string) ?? '');
    const [siteName, setSiteName] = useState((existingEvent?.site_name as string) ?? '');

    // Reset when dialog opens with new event data
    useEffect(() => {
        if (isOpen) {
            setEventType((existingEvent?.type as EventType) ?? initialEventType ?? 'birth');
            setDate((existingEvent?.date as string) ?? '');
            const loc = existingEvent?.location;
            if (loc && typeof loc === 'object' && 'name' in loc) {
                setLocationQuery(formatPlaceDisplay(loc as Place));
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
            setBranch((existingEvent?.branch as string) ?? '');
            setRank((existingEvent?.rank as string) ?? '');
            setSiteName((existingEvent?.site_name as string) ?? '');
            setEventAssets((existingEvent?.assets as string[]) ?? []);
        }
    }, [isOpen, existingEvent, initialEventType]);

    const updatePerson = useUpdatePerson();

    const buildEvent = useCallback((): Record<string, unknown> => {
        const base: Record<string, unknown> = { type: eventType, assets: eventAssets };
        if (existingEvent?.id) base.id = existingEvent.id;
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
        if (siteName.trim()) base.site_name = siteName.trim();
        if (description) base.description = description;

        switch (eventType) {
            case 'marriage':
                base.partner_id = partnerId;
                base.status = marriageStatus;
                break;
            case 'divorce':
            case 'engagement':
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
            case 'military_service':
                base.branch = branch;
                if (rank) base.rank = rank;
                break;
            case 'generic':
                if (title) base.title = title;
                break;
        }
        return base;
    }, [
        eventType, date, locationPlace, locationQuery, siteName, description,
        partnerId, marriageStatus, cause, title, organization,
        institution, degree, householdId, branch, rank, eventAssets, existingEvent,
    ]);

    const handleDeleteEvent = () => setConfirmDelete(true);

    const handleConfirmDelete = () => {
        const updatedEvents = currentEvents.filter((_, i) => i !== existingEventIndex);
        updatePerson.mutate(
            { id: personId, updates: { events: updatedEvents } },
            {
                onSuccess: () => {
                    toast.success('Event deleted.');
                    setConfirmDelete(false);
                    onClose();
                },
                onError: () => toast.error('Failed to delete event.'),
            }
        );
    };

    const handleSave = () => {
        const required = getRequiredFields(eventType);
        const eventData: Record<string, string | undefined> = {
            partner_id: partnerId, title, institution, branch,
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
                onError: () => toast.error('Failed to save event.'),
            }
        );
    };

    // Visible assets filtered to only those that still exist in the gallery
    const visibleEventAssets = eventAssets.filter(fn =>
        allAssetsData == null || assetSet.has(fn)
    );

    return (
        <>
        <Dialog open={isOpen} modal={!lightboxFile && !deleteAssetTarget} onOpenChange={(o) => !o && onClose()}>
            <DialogContent
                className="max-w-lg max-h-[90vh] overflow-y-auto"
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => {
                    if (lightboxFile) {
                        e.preventDefault();
                        setLightboxFile(null);
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Event' : 'Add Event'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Event type selector */}
                    <EventTypeSelector value={eventType} onChange={setEventType} />

                    {/* Date */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium">Date</label>
                        <SmartDateInput
                            value={date}
                            onChange={(val) => setDate(val)}
                            placeholder="e.g. 15 Jun 1920 or 1920 or abt 1920"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Place</label>
                        <PlaceSearchCombobox
                            value={locationQuery}
                            onChange={(value) => {
                                setLocationQuery(value);
                                setLocationPlace(null);
                            }}
                            onSelect={setLocationPlace}
                            initialPlace={locationPlace}
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Site Name</label>
                        <Input
                            placeholder="e.g. St. Mary's Church, Oak Hill Cemetery"
                            value={siteName}
                            onChange={(e) => setSiteName(e.target.value)}
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
                    {(eventType === 'marriage' || eventType === 'divorce' || eventType === 'engagement') && (
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

                    {eventType === 'military_service' && (
                        <>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">
                                    Branch <span className="text-destructive">*</span>
                                </label>
                                <Input
                                    placeholder="e.g. US Army, Royal Navy"
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">Rank</label>
                                <Input
                                    placeholder="e.g. Sergeant, Captain"
                                    value={rank}
                                    onChange={(e) => setRank(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </>
                    )}

                    {/* Linked Assets */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium flex items-center gap-1">
                            <Link2 className="h-3 w-3" /> Linked Assets
                        </label>

                        {/* Thumbnail gallery */}
                        {visibleEventAssets.length > 0 && (
                            <div className="grid grid-cols-3 gap-2">
                                {visibleEventAssets.map((fn) => {
                                    const isImg = assetType(fn) === 'image';
                                    return (
                                        <div key={fn} className="relative group aspect-square">
                                            <button
                                                type="button"
                                                onClick={() => setLightboxFile(fn)}
                                                className="w-full h-full rounded-md border border-border bg-muted overflow-hidden hover:border-primary/60 transition-colors"
                                            >
                                                {isImg ? (
                                                    <img
                                                        src={`/assets/${fn}`}
                                                        alt={fn}
                                                        className="object-cover w-full h-full"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center w-full h-full gap-1 p-1">
                                                        <FileText className="h-5 w-5 text-muted-foreground" />
                                                        <span className="text-[8px] text-muted-foreground text-center break-all leading-tight line-clamp-2">{fn}</span>
                                                    </div>
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEventAssets((prev) => prev.filter((a) => a !== fn))}
                                                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                                            >
                                                <X className="h-3 w-3 text-white" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="flex gap-2">
                            {isEdit && (
                                <>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,.pdf,.txt,.md"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const eventId = existingEvent?.id as string | undefined;
                                            if (!eventId) return;
                                            uploadEventMedia.mutate(
                                                { personId, eventId, file },
                                                {
                                                    onSuccess: (result) => {
                                                        setEventAssets((prev) => [...prev, result.filename]);
                                                        toast.success('File attached.');
                                                    },
                                                    onError: () => toast.error('Upload failed.'),
                                                }
                                            );
                                            e.target.value = '';
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploadEventMedia.isPending}
                                        className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50"
                                    >
                                        <Upload className="h-3 w-3" />
                                        {uploadEventMedia.isPending ? 'Uploading…' : 'Upload new'}
                                    </button>
                                </>
                            )}
                            {!isEdit && (
                                <p className="text-[10px] text-muted-foreground italic">
                                    Save event first to upload files.
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={() => setAssetPickerOpen(true)}
                                className="flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-muted transition-colors"
                            >
                                <Link2 className="h-3 w-3" /> Link existing
                            </button>
                        </div>
                    </div>
                </div>

                <AssetPickerDialog
                    open={assetPickerOpen}
                    onOpenChange={setAssetPickerOpen}
                    onConfirm={(filenames) => setEventAssets((prev) => {
                        const toAdd = filenames.filter(fn => !prev.includes(fn));
                        return [...prev, ...toAdd];
                    })}
                    excludeFilenames={eventAssets}
                    title="Link Assets to Event"
                    preloadPersonChip={personChip}
                />

                <DialogFooter>
                    {isEdit && (
                        <Button
                            variant="destructive"
                            size="sm"
                            className="mr-auto"
                            onClick={handleDeleteEvent}
                            disabled={updatePerson.isPending}
                        >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            Delete Event
                        </Button>
                    )}
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

        <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Delete Event?</DialogTitle>
                    <DialogDescription>
                        This will permanently remove this <strong>{eventType}</strong> event. This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleConfirmDelete}
                        disabled={updatePerson.isPending}
                    >
                        {updatePerson.isPending ? 'Deleting…' : 'Delete Event'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {lightboxFile && createPortal(
            <AssetLightbox
                filename={lightboxFile}
                allFilenames={visibleEventAssets}
                assetData={allAssetsData?.assets.find(a => a.filename === lightboxFile)}
                onClose={() => setLightboxFile(null)}
                onNavigate={(fn) => setLightboxFile(fn)}
                onDeleteRequest={(fn) => setDeleteAssetTarget(fn)}
            />,
            document.body
        )}

        {deleteAssetTarget && createPortal(
            <Dialog open onOpenChange={(open) => { if (!open) setDeleteAssetTarget(null); }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Remove asset?</DialogTitle>
                        <DialogDescription>
                            What would you like to do with <span className="font-mono text-xs">{deleteAssetTarget}</span>?
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 pb-2 space-y-2 text-sm text-muted-foreground">
                        <p><strong className="text-foreground">Remove from event</strong> — unlinks the file from this event. It stays in the asset gallery.</p>
                        <p><strong className="text-foreground">Delete asset</strong> — permanently removes the file from disk.</p>
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" size="sm" onClick={() => setDeleteAssetTarget(null)}>Cancel</Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={updatePerson.isPending}
                            onClick={() => {
                                const fn = deleteAssetTarget;
                                const idx = visibleEventAssets.indexOf(fn);
                                const next = idx >= 0 ? (visibleEventAssets[idx + 1] ?? visibleEventAssets[idx - 1] ?? null) : null;
                                const newAssets = eventAssets.filter(a => a !== fn);
                                setDeleteAssetTarget(null);
                                setEventAssets(newAssets);
                                if (lightboxFile === fn) setLightboxFile(next);
                                if (isEdit) {
                                    const updatedEvent = { ...buildEvent(), assets: newAssets };
                                    const updatedEvents = currentEvents.map((e, i) =>
                                        i === existingEventIndex ? updatedEvent : e
                                    );
                                    updatePerson.mutate(
                                        { id: personId, updates: { events: updatedEvents } },
                                        {
                                            onSuccess: () => toast.success('Asset removed from event.'),
                                            onError: () => toast.error('Failed to remove asset from event.'),
                                        }
                                    );
                                }
                            }}
                        >
                            Remove from event
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteGalleryAsset.isPending}
                            onClick={() => {
                                const fn = deleteAssetTarget;
                                const idx = visibleEventAssets.indexOf(fn);
                                const next = idx >= 0 ? (visibleEventAssets[idx + 1] ?? visibleEventAssets[idx - 1] ?? null) : null;
                                setDeleteAssetTarget(null);
                                setEventAssets(prev => prev.filter(a => a !== fn));
                                if (lightboxFile === fn) setLightboxFile(next);
                                deleteGalleryAsset.mutate(
                                    { filename: fn, force: true },
                                    { onError: () => toast.error('Failed to delete asset.') }
                                );
                            }}
                        >
                            {deleteGalleryAsset.isPending ? 'Deleting…' : 'Delete asset'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>,
            document.body
        )}
    </>
    );
}
