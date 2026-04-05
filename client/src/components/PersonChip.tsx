import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { usePerson } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Sunrise, Sunset } from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadAvatarCrop } from '@/lib/avatarCrop';

interface PersonChipProps {
    id: string;
    name?: string;
    photoFilename?: string;
    className?: string;
}

export function deriveName(person: { names?: Array<{ first?: string; given?: string; last?: string; surname?: string }> } | undefined) {
    const n = person?.names?.[0];
    return `${n?.first || n?.given || ''} ${n?.last || n?.surname || ''}`.trim() || 'Unknown';
}

export function PersonChip({ id, name, photoFilename, className }: PersonChipProps) {
    const [open, setOpen] = useState(false);
    // Always fetch so the chip can display names without requiring the caller to pass them
    const { data: person } = usePerson(id);

    const displayName = name ?? (person ? deriveName(person) : null);
    const firstAsset = photoFilename ?? person?.assets?.[0];

    // Split displayName for avatar initials
    const parts = displayName?.split(' ') ?? [];
    const avatarFirst = parts[0] ?? '';
    const avatarLast = parts.slice(1).join(' ') ?? '';

    return (
        <HoverCard open={open} onOpenChange={setOpen}>
            <HoverCardTrigger asChild>
                <Link
                    to="/people/$id"
                    params={{ id }}
                    className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-sm',
                        className
                    )}
                >
                    <CustomAvatar
                        firstName={avatarFirst}
                        lastName={avatarLast}
                        photoFilename={firstAsset}
                        className="h-6 w-6 text-[10px]"
                        cropData={loadAvatarCrop(id)}
                        sex={person?.sex}
                    />
                    <span className="truncate">
                        {displayName ?? <span className="font-mono text-xs text-muted-foreground">{id}</span>}
                    </span>
                </Link>
            </HoverCardTrigger>
            <HoverCardContent className="w-64" side="right">
                {open && <PersonHoverContent id={id} person={person} />}
            </HoverCardContent>
        </HoverCard>
    );
}

export function PersonHoverContent({
    id,
    person,
}: {
    id: string;
    person: ReturnType<typeof usePerson>['data'];
}) {
    if (!person) {
        return <div className="text-xs text-muted-foreground">Loading...</div>;
    }

    const displayName = deriveName(person);
    const events = (person.events ?? []) as Array<Record<string, string>>;
    const birthDate = events.find((e) => e.type === 'birth')?.date;
    const deathDate = events.find((e) => e.type === 'death')?.date;
    const spouse = person._computed?.currentSpouse;
    const cropData = loadAvatarCrop(id);

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <CustomAvatar
                    firstName={person.names?.[0]?.first || person.names?.[0]?.given || ''}
                    lastName={person.names?.[0]?.last || person.names?.[0]?.surname || ''}
                    photoFilename={person.assets?.[0]}
                    className="h-10 w-10 text-sm"
                    cropData={cropData}
                    sex={person.sex}
                />
                <div>
                    <p className="font-semibold text-sm">{displayName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{id}</p>
                </div>
            </div>
            {(birthDate || deathDate) && (
                <div className="space-y-1">
                    {birthDate && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Sunrise className="h-3 w-3" />
                            <span>b. {birthDate}</span>
                        </div>
                    )}
                    {deathDate && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Sunset className="h-3 w-3" />
                            <span>d. {deathDate}</span>
                        </div>
                    )}
                </div>
            )}
            {spouse && (
                <div className="text-xs text-muted-foreground">
                    <span className="capitalize">{spouse.status}</span> to{' '}
                    <span className="font-mono">{spouse.id}</span>
                </div>
            )}
        </div>
    );
}
