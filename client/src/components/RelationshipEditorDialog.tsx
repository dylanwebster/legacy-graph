import { useState, useEffect } from 'react';
import { useUpdatePerson } from '@/api/hooks';
import { useSearch } from '@/api/hooks';
import { peopleApi } from '@/api/people';
import { PersonChip } from '@/components/PersonChip';
import { CustomAvatar } from '@/components/CustomAvatar';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { X } from 'lucide-react';

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
}

function PersonSearchCombobox({
    value,
    onChange,
    placeholder = 'Search people...',
    excludeIds = [],
}: {
    value: string;
    onChange: (id: string) => void;
    placeholder?: string;
    excludeIds?: string[];
}) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const { data: searchResults } = useSearch(debouncedQuery, { limit: 8 });

    const people = (searchResults?.people ?? []).filter(
        (p: { id: string }) => !excludeIds.includes(p.id)
    ) as Array<{
        id: string;
        names: Array<{ first?: string; given?: string; last?: string; surname?: string }>;
        assets?: string[];
    }>;

    const handleSelect = (id: string) => {
        onChange(id);
        const found = people.find((p) => p.id === id);
        if (found) {
            const n = found.names?.[0];
            setQuery(`${n?.first || n?.given || ''} ${n?.last || n?.surname || ''}`.trim() || id);
        } else {
            setQuery(id);
        }
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
            {value && !showDropdown && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">{value}</p>
            )}
            {showDropdown && debouncedQuery && people.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-md max-h-48 overflow-auto">
                    {people.map((p) => {
                        const n = p.names?.[0];
                        const first = n?.first || n?.given || '';
                        const last = n?.last || n?.surname || '';
                        const name = `${first} ${last}`.trim() || p.id;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                                onMouseDown={() => handleSelect(p.id)}
                            >
                                <CustomAvatar firstName={first} lastName={last} photoFilename={p.assets?.[0]} className="h-5 w-5 text-[9px]" />
                                <span className="truncate">{name}</span>
                                <span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">{p.id}</span>
                            </button>
                        );
                    })}
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

export function RelationshipEditorDialog({
    isOpen,
    onClose,
    personId,
    currentParents,
    currentChildIds,
    allSpouses,
    currentEvents,
}: RelationshipEditorDialogProps) {
    const updatePerson = useUpdatePerson();

    // --- Parents state ---
    const [newParentId, setNewParentId] = useState('');
    const [newParentType, setNewParentType] = useState<typeof RELATIONSHIP_TYPES[number]>('biological');

    // --- Children state ---
    const [newChildId, setNewChildId] = useState('');
    const [newChildType, setNewChildType] = useState<typeof RELATIONSHIP_TYPES[number]>('biological');
    const [addingChild, setAddingChild] = useState(false);

    // --- Spouses state ---
    const [newSpouseId, setNewSpouseId] = useState('');
    const [newSpouseStatus, setNewSpouseStatus] = useState<typeof MARRIAGE_STATUSES[number]>('married');
    const [newSpouseDate, setNewSpouseDate] = useState('');

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setNewParentId('');
            setNewChildId('');
            setNewSpouseId('');
            setNewSpouseDate('');
        }
    }, [isOpen]);

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
        setAddingChild(true);
        try {
            const child = await peopleApi.getPerson(newChildId);
            const childParents = child.relationships?.parents ?? [];
            if (childParents.some((p) => p.id === personId)) {
                toast.error('Already linked as a parent of that person.');
                return;
            }
            updatePerson.mutate(
                { id: newChildId, updates: { relationships: { parents: [...childParents, { id: personId, type: newChildType }] } } },
                {
                    onSuccess: () => { toast.success('Child added.'); setNewChildId(''); onClose(); },
                    onError: () => toast.error('Failed to add child.'),
                }
            );
        } catch {
            toast.error('Could not load the selected person\'s data.');
        } finally {
            setAddingChild(false);
        }
    };

    const handleRemoveChild = async (childId: string) => {
        try {
            const child = await peopleApi.getPerson(childId);
            const updatedParents = (child.relationships?.parents ?? []).filter((p) => p.id !== personId);
            updatePerson.mutate(
                { id: childId, updates: { relationships: { parents: updatedParents } } },
                {
                    onSuccess: () => toast.success('Child removed.'),
                    onError: () => toast.error('Failed to remove child.'),
                }
            );
        } catch {
            toast.error('Could not load the child\'s data.');
        }
    };

    // ─── Spouses ────────────────────────────────────────────────────────────────

    const handleAddSpouse = () => {
        if (!newSpouseId) { toast.error('Please select a partner.'); return; }
        if (allSpouses.some((s) => s.id === newSpouseId)) { toast.error('Already linked as a spouse.'); return; }
        const event: Record<string, unknown> = {
            type: 'marriage',
            partner_id: newSpouseId,
            status: newSpouseStatus,
        };
        if (newSpouseDate.trim()) {
            event.date = newSpouseDate.trim();
            event.sort_date = newSpouseDate.trim();
        }
        updatePerson.mutate(
            { id: personId, updates: { events: [...currentEvents, event] } },
            {
                onSuccess: () => { toast.success('Spouse added.'); setNewSpouseId(''); setNewSpouseDate(''); onClose(); },
                onError: () => toast.error('Failed to add spouse.'),
            }
        );
    };

    const handleRemoveSpouse = (spouseId: string) => {
        // Remove the last marriage/divorce event that links this spouse
        const idx = currentEvents.reduceRight((found, e, i) =>
            found === -1 && (e.type === 'marriage' || e.type === 'divorce') && e.partner_id === spouseId ? i : found
        , -1);
        if (idx === -1) { toast.error('Could not find the marriage event to remove.'); return; }
        const updatedEvents = currentEvents.filter((_, i) => i !== idx);
        updatePerson.mutate(
            { id: personId, updates: { events: updatedEvents } },
            {
                onSuccess: () => toast.success('Spouse removed.'),
                onError: () => toast.error('Failed to remove spouse.'),
            }
        );
    };

    const isSaving = updatePerson.isPending || addingChild;
    const currentParentIds = currentParents.map((p) => p.id);
    const currentSpouseIds = allSpouses.map((s) => s.id);

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Manage Relationships</DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="parents" className="mt-2">
                    <TabsList className="w-full">
                        <TabsTrigger value="parents" className="flex-1">
                            Parents {currentParents.length > 0 && `(${currentParents.length})`}
                        </TabsTrigger>
                        <TabsTrigger value="children" className="flex-1">
                            Children {currentChildIds.length > 0 && `(${currentChildIds.length})`}
                        </TabsTrigger>
                        <TabsTrigger value="spouses" className="flex-1">
                            Spouses {allSpouses.length > 0 && `(${allSpouses.length})`}
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
                                <PersonSearchCombobox value={newParentId} onChange={setNewParentId} excludeIds={[personId, ...currentParentIds]} />
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
                                <PersonSearchCombobox value={newChildId} onChange={setNewChildId} excludeIds={[personId, ...currentChildIds]} />
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
                                <PersonSearchCombobox value={newSpouseId} onChange={setNewSpouseId} excludeIds={[personId, ...currentSpouseIds]} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">Status</label>
                                <TypePicker options={MARRIAGE_STATUSES} value={newSpouseStatus} onChange={setNewSpouseStatus} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">Date (optional)</label>
                                <Input
                                    placeholder="e.g. 15 Jun 1950"
                                    value={newSpouseDate}
                                    onChange={(e) => setNewSpouseDate(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                            <Button onClick={handleAddSpouse} size="sm" disabled={isSaving || !newSpouseId}>
                                {isSaving ? 'Saving…' : 'Add Spouse'}
                            </Button>
                        </DialogFooter>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
