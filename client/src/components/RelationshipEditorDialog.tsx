import { useState } from 'react';
import { useUpdatePerson } from '@/api/hooks';
import { PersonChip } from '@/components/PersonChip';
import { useSearch } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { useEffect } from 'react';

const RELATIONSHIP_TYPES = ['biological', 'adopted', 'step', 'foster'] as const;

interface RelationshipEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    personId: string;
    currentParents: Array<{ id: string; type: string }>;
}

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

    const people = (searchResults?.people ?? []) as Array<{
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
                                <CustomAvatar
                                    firstName={first}
                                    lastName={last}
                                    photoFilename={p.assets?.[0]}
                                    className="h-5 w-5 text-[9px]"
                                />
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

export function RelationshipEditorDialog({
    isOpen,
    onClose,
    personId,
    currentParents,
}: RelationshipEditorDialogProps) {
    const [newParentId, setNewParentId] = useState('');
    const [newParentType, setNewParentType] = useState<typeof RELATIONSHIP_TYPES[number]>('biological');
    const updatePerson = useUpdatePerson();

    const handleAddParent = () => {
        if (!newParentId) {
            toast.error('Please select a parent.');
            return;
        }
        if (currentParents.some((p) => p.id === newParentId)) {
            toast.error('That person is already a parent.');
            return;
        }
        const updated = [...currentParents, { id: newParentId, type: newParentType }];
        updatePerson.mutate(
            { id: personId, updates: { relationships: { parents: updated } } },
            {
                onSuccess: () => {
                    toast.success('Parent added.');
                    setNewParentId('');
                    onClose();
                },
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

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Manage Parents</DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="add" className="mt-2">
                    <TabsList className="w-full">
                        <TabsTrigger value="add" className="flex-1">Add Parent</TabsTrigger>
                        <TabsTrigger value="remove" className="flex-1">
                            Remove Parent {currentParents.length > 0 && `(${currentParents.length})`}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="add" className="space-y-4 pt-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Search for parent</label>
                            <PersonSearchCombobox
                                value={newParentId}
                                onChange={setNewParentId}
                                placeholder="Type a name to search..."
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium">Relationship type</label>
                            <div className="flex gap-2 flex-wrap">
                                {RELATIONSHIP_TYPES.map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setNewParentType(t)}
                                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                            newParentType === t
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                        }`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <DialogFooter className="pt-2">
                            <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                            <Button onClick={handleAddParent} size="sm" disabled={updatePerson.isPending || !newParentId}>
                                {updatePerson.isPending ? 'Saving…' : 'Add Parent'}
                            </Button>
                        </DialogFooter>
                    </TabsContent>

                    <TabsContent value="remove" className="pt-4">
                        {currentParents.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No parents recorded.</p>
                        ) : (
                            <div className="space-y-1">
                                {currentParents.map((parent) => (
                                    <div key={parent.id} className="flex items-center gap-2 group">
                                        <div className="flex-1">
                                            <PersonChip id={parent.id} />
                                        </div>
                                        <span className="text-xs text-muted-foreground capitalize">{parent.type}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveParent(parent.id)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                                            aria-label="Remove parent"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <DialogFooter className="pt-4">
                            <Button variant="outline" onClick={onClose} size="sm">Close</Button>
                        </DialogFooter>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
