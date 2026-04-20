import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdatePerson } from '@/shared/api/hooks';
import { useSearch } from '@/shared/api/hooks';
import { peopleApi } from '@/shared/api/people';
import { PersonChip } from '@/shared/components/PersonChip';
import { CustomAvatar } from '@/shared/components/CustomAvatar';
import { CreatePersonDialog } from '@/components/CreatePersonDialog';
import { SmartDateInput, parseToISO } from '@/components/SmartDateInput';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from 'sonner';
import { X, UserPlus } from 'lucide-react';

const RELATIONSHIP_TYPES = ['biological', 'adopted', 'step', 'foster'] as const;
const MARRIAGE_STATUSES = ['married', 'widowed', 'divorced'] as const;

interface RelationshipEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    personId: string;
    currentParents: Array<{ id: string; type: string }>;
    currentChildIds: string[];
    allSpouses: Array<{ id: string; status: string; sortDate: string }>;
    currentEvents: Array<Record<string, unknown>>;
    siblings?: string[];
}

function PersonSearchCombobox({
    onChange,
    placeholder = 'Search people...',
    excludeIds = [],
    onCreateNew,
    forcedQuery = '',
}: {
    onChange: (id: string) => void;
    placeholder?: string;
    excludeIds?: string[];
    onCreateNew?: (name: string) => void;
    /** When set by parent (e.g. after creating a new person), overrides the input text. */
    forcedQuery?: string;
}) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    // Sync input text when parent drives a selection (e.g. after creating a new person)
    useEffect(() => {
        setQuery(forcedQuery);
    }, [forcedQuery]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const { data: searchResults } = useSearch(debouncedQuery, { limit: 8 });

    // Search API enriches results with `names: PersonName[]` and `birthDate`, not `name: string`
    const people = (searchResults?.people ?? []).filter(
        (p: { id: string }) => !excludeIds.includes(p.id)
    ) as Array<{ id: string; names?: Array<{ first?: string; given?: string; last?: string; surname?: string }>; birthDate?: string; sex?: string }>;

    const handleSelect = (id: string, name?: string) => {
        onChange(id);
        setQuery(name ?? id);
        setShowDropdown(false);
    };

    const showCreate = !!onCreateNew && !!debouncedQuery;
    const showDropdownPanel = showDropdown && debouncedQuery && (people.length > 0 || showCreate);

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
            {showDropdownPanel && (
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
                    {showCreate && (
                        <button
                            type="button"
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left text-primary border-t border-border"
                            onMouseDown={() => { onCreateNew(debouncedQuery); setShowDropdown(false); }}
                        >
                            <UserPlus className="h-4 w-4 shrink-0" />
                            <span>Create &ldquo;{debouncedQuery}&rdquo;</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function TypePicker<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
    return (
        <div className="flex gap-2 flex-wrap">
            {options.map((t) => (
                <button
                    key={t}
                    type="button"
                    onClick={() => onChange(t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        value === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                    }`}
                >
                    {t}
                </button>
            ))}
        </div>
    );
}

/** Split a typed name into first / last for pre-populating CreatePersonDialog. */
function splitName(name: string): { first: string; last: string } {
    const trimmed = name.trim();
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return { first: trimmed, last: '' };
    return { first: trimmed.slice(0, spaceIdx), last: trimmed.slice(spaceIdx + 1) };
}

export function RelationshipEditorDialog({
    isOpen,
    onClose,
    personId,
    currentParents,
    currentChildIds,
    allSpouses,
    currentEvents,
    siblings = [],
}: RelationshipEditorDialogProps) {
    const updatePerson = useUpdatePerson();
    const queryClient = useQueryClient();

    // --- Parents state ---
    const [newParentId, setNewParentId] = useState('');
    const [newParentType, setNewParentType] = useState<typeof RELATIONSHIP_TYPES[number]>('biological');
    const [parentForcedQuery, setParentForcedQuery] = useState('');

    // --- Children state ---
    const [newChildId, setNewChildId] = useState('');
    const [newChildType, setNewChildType] = useState<typeof RELATIONSHIP_TYPES[number]>('biological');
    const [childForcedQuery, setChildForcedQuery] = useState('');
    const [saving, setSaving] = useState(false);

    // --- Spouses state ---
    const [newSpouseId, setNewSpouseId] = useState('');
    const [newSpouseStatus, setNewSpouseStatus] = useState<typeof MARRIAGE_STATUSES[number]>('married');
    const [newSpouseDate, setNewSpouseDate] = useState('');
    const [spouseForcedQuery, setSpouseForcedQuery] = useState('');

    // --- Siblings state ---
    const [newSiblingId, setNewSiblingId] = useState('');
    const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(new Set());
    const [siblingForcedQuery, setSiblingForcedQuery] = useState('');

    // --- Create Person sub-dialog state ---
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createDialogName, setCreateDialogName] = useState('');
    const [onPersonCreated, setOnPersonCreated] = useState<((id: string) => void) | null>(null);
    const [pendingQuerySetter, setPendingQuerySetter] = useState<((name: string) => void) | null>(null);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setNewParentId('');
            setNewChildId('');
            setNewSpouseId('');
            setNewSpouseDate('');
            setNewSiblingId('');
            setSelectedParentIds(new Set());
            setParentForcedQuery('');
            setChildForcedQuery('');
            setSpouseForcedQuery('');
            setSiblingForcedQuery('');
        }
    }, [isOpen]);

    // ─── Create person sub-dialog ────────────────────────────────────────────────

    const openCreateDialog = (name: string, onCreated: (id: string) => void, setQueryFn: (name: string) => void) => {
        setCreateDialogName(name);
        setOnPersonCreated(() => onCreated);
        setPendingQuerySetter(() => setQueryFn);
        setCreateDialogOpen(true);
    };

    const handlePersonCreated = (id: string) => {
        onPersonCreated?.(id);
        // Populate the combobox input with the created person's name
        pendingQuerySetter?.(createDialogName);
        setCreateDialogOpen(false);
    };

    const { first: createFirst, last: createLast } = splitName(createDialogName);

    // ─── Parents ────────────────────────────────────────────────────────────────

    const handleAddParent = () => {
        if (!newParentId) { toast.error('Please select a parent.'); return; }
        if (currentParents.some((p) => p.id === newParentId)) { toast.error('That person is already a parent.'); return; }
        const updated = [...currentParents, { id: newParentId, type: newParentType }];
        updatePerson.mutate(
            { id: personId, updates: { relationships: { parents: updated } } },
            {
                onSuccess: () => { toast.success('Parent added.'); setNewParentId(''); onClose(); },
                onError: () => toast.error('Failed to add parent.'),
            }
        );
    };

    const handleRemoveParent = (parentId: string) => {
        const updated = currentParents.filter((p) => p.id !== parentId);
        updatePerson.mutate(
            { id: personId, updates: { relationships: { parents: updated } } },
            {
                onSuccess: () => toast.success('Parent removed.'),
                onError: () => toast.error('Failed to remove parent.'),
            }
        );
    };

    // ─── Children ───────────────────────────────────────────────────────────────

    const handleAddChild = async () => {
        if (!newChildId) { toast.error('Please select a child.'); return; }
        if (currentChildIds.includes(newChildId)) { toast.error('Already a child.'); return; }
        setSaving(true);
        try {
            const child = await peopleApi.getPerson(newChildId);
            const childParents = child.relationships?.parents ?? [];
            if (childParents.some((p) => p.id === personId)) {
                toast.error('Already linked as a parent of that person.');
                return;
            }
            await updatePerson.mutateAsync(
                { id: newChildId, updates: { relationships: { parents: [...childParents, { id: personId, type: newChildType }] } } }
            );
            // Invalidate the current person so their children list refreshes
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
            toast.success('Child added.');
            setNewChildId('');
            onClose();
        } catch {
            toast.error('Failed to add child.');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveChild = async (childId: string) => {
        setSaving(true);
        try {
            const child = await peopleApi.getPerson(childId);
            const updatedParents = (child.relationships?.parents ?? []).filter((p) => p.id !== personId);
            await updatePerson.mutateAsync({ id: childId, updates: { relationships: { parents: updatedParents } } });
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
            toast.success('Child removed.');
        } catch {
            toast.error('Failed to remove child.');
        } finally {
            setSaving(false);
        }
    };

    // ─── Spouses ────────────────────────────────────────────────────────────────

    const handleAddSpouse = async () => {
        if (!newSpouseId) { toast.error('Please select a partner.'); return; }
        if (allSpouses.some((s) => s.id === newSpouseId)) { toast.error('Already linked as a spouse.'); return; }

        const buildEvent = (partnerId: string): Record<string, unknown> => {
            const ev: Record<string, unknown> = { type: 'marriage', partner_id: partnerId, status: newSpouseStatus };
            if (newSpouseDate.trim()) {
                ev.date = newSpouseDate.trim();
                const iso = parseToISO(newSpouseDate.trim());
                if (iso) ev.sort_date = iso;
            }
            return ev;
        };

        setSaving(true);
        try {
            // Write marriage event on the current person
            await updatePerson.mutateAsync({ id: personId, updates: { events: [...currentEvents, buildEvent(newSpouseId)] } });

            // Write the reverse marriage event on the spouse so their page shows the link too
            const spouse = await peopleApi.getPerson(newSpouseId);
            const spouseEvents = (spouse.events ?? []) as Array<Record<string, unknown>>;
            const alreadyLinked = spouseEvents.some(
                (e) => (e.type === 'marriage' || e.type === 'divorce') && e.partner_id === personId
            );
            if (!alreadyLinked) {
                await updatePerson.mutateAsync({ id: newSpouseId, updates: { events: [...spouseEvents, buildEvent(personId)] } });
            }

            toast.success('Spouse added.');
            setNewSpouseId('');
            setNewSpouseDate('');
            onClose();
        } catch {
            toast.error('Failed to add spouse.');
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveSpouse = async (spouseId: string) => {
        const idx = currentEvents.reduceRight((found, e, i) =>
            found === -1 && (e.type === 'marriage' || e.type === 'divorce') && e.partner_id === spouseId ? i : found
        , -1);
        if (idx === -1) { toast.error('Could not find the marriage event to remove.'); return; }

        setSaving(true);
        try {
            // Remove marriage event from the current person
            const updatedEvents = currentEvents.filter((_, i) => i !== idx);
            await updatePerson.mutateAsync({ id: personId, updates: { events: updatedEvents } });

            // Also remove the reverse event from the spouse's record
            const spouse = await peopleApi.getPerson(spouseId);
            const spouseEvents = (spouse.events ?? []) as Array<Record<string, unknown>>;
            const reverseIdx = spouseEvents.reduceRight((found, e, i) =>
                found === -1 && (e.type === 'marriage' || e.type === 'divorce') && e.partner_id === personId ? i : found
            , -1);
            if (reverseIdx !== -1) {
                const updatedSpouseEvents = spouseEvents.filter((_, i) => i !== reverseIdx);
                await updatePerson.mutateAsync({ id: spouseId, updates: { events: updatedSpouseEvents } });
            }

            toast.success('Spouse removed.');
        } catch {
            toast.error('Failed to remove spouse.');
        } finally {
            setSaving(false);
        }
    };

    // ─── Siblings ───────────────────────────────────────────────────────────────

    const handleAddSibling = async () => {
        if (!newSiblingId) { toast.error('Please select a person.'); return; }
        if (selectedParentIds.size === 0) { toast.error('Please select at least one shared parent.'); return; }
        if (siblings.includes(newSiblingId)) { toast.error('Already a sibling.'); return; }

        setSaving(true);
        try {
            const sibling = await peopleApi.getPerson(newSiblingId);
            const siblingParents = sibling.relationships?.parents ?? [];

            // Add all selected parents that the sibling doesn't already have
            const parentsToAdd = Array.from(selectedParentIds)
                .filter((pid) => !siblingParents.some((p) => p.id === pid))
                .map((pid) => {
                    const parentEntry = currentParents.find((p) => p.id === pid);
                    return { id: pid, type: parentEntry?.type ?? 'biological' };
                });

            if (parentsToAdd.length === 0) {
                toast.error('That person already shares all selected parents.');
                return;
            }

            await updatePerson.mutateAsync({
                id: newSiblingId,
                updates: { relationships: { parents: [...siblingParents, ...parentsToAdd] } }
            });
            queryClient.invalidateQueries({ queryKey: ['person', personId] });
            toast.success('Sibling added.');
            setNewSiblingId('');
            setSelectedParentIds(new Set());
            onClose();
        } catch {
            toast.error('Failed to add sibling.');
        } finally {
            setSaving(false);
        }
    };

    const isSaving = updatePerson.isPending || saving;
    const currentParentIds = currentParents.map((p) => p.id);
    const currentSpouseIds = allSpouses.map((s) => s.id);

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Manage Relationships</DialogTitle>
                    </DialogHeader>

                    <Tabs defaultValue="parents" className="mt-2">
                        <TabsList className="w-full">
                            <TabsTrigger value="parents" className="flex-1 text-xs">
                                Parents {currentParents.length > 0 && `(${currentParents.length})`}
                            </TabsTrigger>
                            <TabsTrigger value="children" className="flex-1 text-xs">
                                Children {currentChildIds.length > 0 && `(${currentChildIds.length})`}
                            </TabsTrigger>
                            <TabsTrigger value="spouses" className="flex-1 text-xs">
                                Spouses {allSpouses.length > 0 && `(${allSpouses.length})`}
                            </TabsTrigger>
                            <TabsTrigger value="siblings" className="flex-1 text-xs">
                                Siblings {siblings.length > 0 && `(${siblings.length})`}
                            </TabsTrigger>
                        </TabsList>

                        {/* ── Parents tab ── */}
                        <TabsContent value="parents" className="space-y-4 pt-4">
                            {currentParents.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current parents</p>
                                    {currentParents.map((parent) => (
                                        <div key={parent.id} className="flex items-center gap-2 group">
                                            <div className="flex-1"><PersonChip id={parent.id} /></div>
                                            <span className="text-xs text-muted-foreground capitalize">{parent.type}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveParent(parent.id)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-3 border-t border-border pt-3">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add parent</p>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Search</label>
                                    <PersonSearchCombobox
                                        onChange={setNewParentId}
                                        excludeIds={[personId, ...currentParentIds]}
                                        onCreateNew={(name) => openCreateDialog(name, setNewParentId, setParentForcedQuery)}
                                        forcedQuery={parentForcedQuery}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Relationship type</label>
                                    <TypePicker options={RELATIONSHIP_TYPES} value={newParentType} onChange={setNewParentType} />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                                <Button onClick={handleAddParent} size="sm" disabled={isSaving || !newParentId}>
                                    {isSaving ? 'Saving…' : 'Add Parent'}
                                </Button>
                            </DialogFooter>
                        </TabsContent>

                        {/* ── Children tab ── */}
                        <TabsContent value="children" className="space-y-4 pt-4">
                            {currentChildIds.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current children</p>
                                    {currentChildIds.map((childId) => (
                                        <div key={childId} className="flex items-center gap-2 group">
                                            <div className="flex-1"><PersonChip id={childId} /></div>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveChild(childId)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-3 border-t border-border pt-3">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add child</p>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Search</label>
                                    <PersonSearchCombobox
                                        onChange={setNewChildId}
                                        excludeIds={[personId, ...currentChildIds]}
                                        onCreateNew={(name) => openCreateDialog(name, setNewChildId, setChildForcedQuery)}
                                        forcedQuery={childForcedQuery}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Relationship type</label>
                                    <TypePicker options={RELATIONSHIP_TYPES} value={newChildType} onChange={setNewChildType} />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                                <Button onClick={handleAddChild} size="sm" disabled={isSaving || !newChildId}>
                                    {isSaving ? 'Saving…' : 'Add Child'}
                                </Button>
                            </DialogFooter>
                        </TabsContent>

                        {/* ── Spouses tab ── */}
                        <TabsContent value="spouses" className="space-y-4 pt-4">
                            {allSpouses.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current spouses</p>
                                    {allSpouses.map((spouse) => (
                                        <div key={spouse.id} className="flex items-center gap-2 group">
                                            <div className="flex-1"><PersonChip id={spouse.id} /></div>
                                            <span className="text-xs text-muted-foreground capitalize">{spouse.status}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveSpouse(spouse.id)}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-3 border-t border-border pt-3">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add spouse</p>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Search</label>
                                    <PersonSearchCombobox
                                        onChange={setNewSpouseId}
                                        excludeIds={[personId, ...currentSpouseIds]}
                                        onCreateNew={(name) => openCreateDialog(name, setNewSpouseId, setSpouseForcedQuery)}
                                        forcedQuery={spouseForcedQuery}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Status</label>
                                    <TypePicker options={MARRIAGE_STATUSES} value={newSpouseStatus} onChange={setNewSpouseStatus} />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-medium">Date (optional)</label>
                                    <SmartDateInput
                                        value={newSpouseDate}
                                        onChange={(val) => setNewSpouseDate(val)}
                                        placeholder="e.g. 15 Jun 1950"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                                <Button
                                    onClick={handleAddSpouse}
                                    size="sm"
                                    disabled={isSaving || !newSpouseId || (!!newSpouseDate.trim() && parseToISO(newSpouseDate) === null)}
                                    title={!!newSpouseDate.trim() && parseToISO(newSpouseDate) === null ? 'Fix the date before saving' : undefined}
                                >
                                    {isSaving ? 'Saving…' : 'Add Spouse'}
                                </Button>
                            </DialogFooter>
                        </TabsContent>

                        {/* ── Siblings tab ── */}
                        <TabsContent value="siblings" className="space-y-4 pt-4">
                            {siblings.length > 0 && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current siblings</p>
                                    {siblings.map((sibId) => (
                                        <div key={sibId} className="flex items-center gap-2">
                                            <div className="flex-1"><PersonChip id={sibId} /></div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {currentParents.length > 0 ? (
                                <div className="space-y-3 border-t border-border pt-3">
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add sibling</p>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Person</label>
                                        <PersonSearchCombobox
                                            onChange={setNewSiblingId}
                                            excludeIds={[personId, ...siblings]}
                                            onCreateNew={(name) => openCreateDialog(name, setNewSiblingId, setSiblingForcedQuery)}
                                            forcedQuery={siblingForcedQuery}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-medium">Shared parents</label>
                                        <div className="space-y-1.5">
                                            {currentParents.map((p) => {
                                                const label = p.id.replace(/^N_/, '').split('-').slice(0, 2).join(' ') || p.id;
                                                const checked = selectedParentIds.has(p.id);
                                                return (
                                                    <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e) => {
                                                                setSelectedParentIds((prev) => {
                                                                    const next = new Set(prev);
                                                                    if (e.target.checked) next.add(p.id);
                                                                    else next.delete(p.id);
                                                                    return next;
                                                                });
                                                            }}
                                                            className="rounded border-border h-3.5 w-3.5"
                                                        />
                                                        <span className="text-xs truncate max-w-[180px]" title={p.id}>{label}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        To remove a sibling, manage the shared parent relationship on either person's page.
                                    </p>
                                </div>
                            ) : (
                                <div className="border-t border-border pt-3">
                                    <p className="text-xs text-muted-foreground">
                                        Add parents to this person first, then you can link siblings via shared parents.
                                    </p>
                                </div>
                            )}
                            <DialogFooter>
                                <Button variant="outline" onClick={onClose} size="sm">Close</Button>
                                {currentParents.length > 0 && (
                                    <Button
                                        onClick={handleAddSibling}
                                        size="sm"
                                        disabled={isSaving || !newSiblingId || selectedParentIds.size === 0}
                                    >
                                        {isSaving ? 'Saving…' : 'Add Sibling'}
                                    </Button>
                                )}
                            </DialogFooter>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>

            <CreatePersonDialog
                isOpen={createDialogOpen}
                onClose={() => setCreateDialogOpen(false)}
                onCreated={handlePersonCreated}
                initialFirstName={createFirst}
                initialLastName={createLast}
            />
        </>
    );
}
