import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { usePerson } from '@/shared/api/hooks';
import { CustomAvatar } from '@/shared/components/CustomAvatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/shared/ui/hover-card';
import { cn } from '@/shared/lib/cn';
import { loadAvatarCrop } from '@/shared/lib/avatarCrop';
import { PersonHoverCard } from '@/shared/components/PersonHoverCard';

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
                {open && <PersonHoverCard id={id} />}
            </HoverCardContent>
        </HoverCard>
    );
}

