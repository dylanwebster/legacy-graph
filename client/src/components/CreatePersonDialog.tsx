import { useState, useEffect } from 'react';
import { useCreatePerson } from '@/api/hooks';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

const SEX_OPTIONS = [
    { value: 'M', label: 'Male' },
    { value: 'F', label: 'Female' },
    { value: 'I', label: 'Intersex' },
    { value: 'U', label: 'Unknown' },
] as const;

interface CreatePersonDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated?: (id: string) => void;
    initialFirstName?: string;
    initialLastName?: string;
}

export function CreatePersonDialog({ isOpen, onClose, onCreated, initialFirstName = '', initialLastName = '' }: CreatePersonDialogProps) {
    const [firstName, setFirstName] = useState(initialFirstName);
    const [lastName, setLastName] = useState(initialLastName);
    const [sex, setSex] = useState<'M' | 'F' | 'I' | 'U'>('M');
    const createPerson = useCreatePerson();

    useEffect(() => {
        if (isOpen) {
            setFirstName(initialFirstName);
            setLastName(initialLastName);
            setSex('M');
        }
    }, [isOpen, initialFirstName, initialLastName]);

    const handleCreate = () => {
        if (!firstName.trim() && !lastName.trim()) {
            toast.error('Please enter at least a first or last name.');
            return;
        }
        createPerson.mutate(
            {
                names: [{ first: firstName.trim(), last: lastName.trim(), primary: true }],
                sex,
            },
            {
                onSuccess: (data) => {
                    toast.success('Person created.');
                    setFirstName('');
                    setLastName('');
                    setSex('M');
                    onCreated?.(data.id);
                    onClose();
                },
                onError: () => {
                    toast.error('Failed to create person.');
                },
            }
        );
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleCreate();
    };

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Create Person</DialogTitle>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium">First Name</label>
                            <Input
                                placeholder="Given name"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium">Last Name</label>
                            <Input
                                placeholder="Surname"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium">Sex</label>
                        <div className="flex gap-2">
                            {SEX_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setSex(opt.value)}
                                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        sex === opt.value
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
                    <Button onClick={handleCreate} size="sm" disabled={createPerson.isPending}>
                        {createPerson.isPending ? 'Creating…' : 'Create'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
