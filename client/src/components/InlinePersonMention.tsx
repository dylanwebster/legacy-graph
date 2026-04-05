import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { usePerson } from '@/api/hooks';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { deriveName } from '@/components/PersonChip';
import { PersonHoverCard } from '@/components/PersonHoverCard';

interface InlinePersonMentionProps {
    id: string;
}

/**
 * Renders an @mentioned person as an inline chip with HoverCard.
 * Unlike PersonChip, this uses inline-flex so it flows within prose text.
 */
export function InlinePersonMention({ id }: InlinePersonMentionProps) {
    const [open, setOpen] = useState(false);
    const { data: person } = usePerson(id);

    const displayName = person ? deriveName(person) : id;

    return (
        <HoverCard open={open} onOpenChange={setOpen}>
            <HoverCardTrigger asChild>
                <Link
                    to="/people/$id"
                    params={{ id }}
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-primary bg-primary/10 hover:bg-primary/20 transition-colors font-medium text-[0.875em] no-underline"
                    style={{ verticalAlign: 'baseline' }}
                >
                    {displayName}
                </Link>
            </HoverCardTrigger>
            <HoverCardContent className="w-64" side="top">
                {open && <PersonHoverCard id={id} />}
            </HoverCardContent>
        </HoverCard>
    );
}
