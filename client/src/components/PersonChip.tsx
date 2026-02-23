import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { usePerson } from '@/api/hooks';
import { CustomAvatar } from '@/components/CustomAvatar';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Calendar, Skull } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PersonChipProps {
    id: string;
    name?: string;
    photoFilename?: string;
    className?: string;
}

function PersonHoverContent({ id }: { id: string }) {
    const { data: person, isLoading } = usePerson(id);

    if (isLoading) {
        return <div className="text-xs text-muted-foreground">Loading...</div>;
    }

    if (!person) {
        return <div className="text-xs text-muted-foreground font-mono">{id}</div>;
    }

    const primaryName = person.names?.[0];
    const firstName = primaryName?.first || primaryName?.given || '';
    const lastName = primaryName?.last || primaryName?.surname || '';
    const displayName = `${firstName} ${lastName}`.trim() || 'Unknown';
    const events = (person.events ?? []) as Array<Record<string, string>>;
    const birthDate = events.find((e) => e.type === 'birth')?.date;
    const deathDate = events.find((e) => e.type === 'death')?.date;
    const spouse = person._computed?.currentSpouse;

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <CustomAvatar
                    firstName={firstName}
                    lastName={lastName}
                    photoFilename={person.assets?.[0]}
                    className="h-10 w-10 text-sm"
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
                            <Calendar className="h-3 w-3" />
                            <span>b. {birthDate}</span>
                        </div>
                    )}
                    {deathDate && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Skull className="h-3 w-3" />
                            <span>d. {deathDate}</span>
                        </div>
                    )}
                </div>
            )}
            {spouse && (
                <div className="text-xs text-muted-foreground">
                    <span className="capitalize">{spouse.status}</span> to <span className="font-mono">{spouse.id}</span>
                </div>
            )}
        </div>
    );
}

export function PersonChip({ id, name, photoFilename, className }: PersonChipProps) {
    const [open, setOpen] = useState(false);

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
                        firstName={name?.split(' ')[0]}
                        lastName={name?.split(' ').slice(1).join(' ')}
                        photoFilename={photoFilename}
                        className="h-6 w-6 text-[10px]"
                    />
                    <span className="truncate">{name || <span className="font-mono text-xs">{id}</span>}</span>
                </Link>
            </HoverCardTrigger>
            <HoverCardContent className="w-64" side="right">
                {open && <PersonHoverContent id={id} />}
            </HoverCardContent>
        </HoverCard>
    );
}
