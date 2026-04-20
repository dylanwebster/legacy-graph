import { PersonChip } from '@/shared/components/PersonChip';

export function RelationshipSection({ title, ids }: { title: string; ids?: string[] }) {
    if (!ids || ids.length === 0) return null;
    return (
        <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{title}</h3>
            <div className="space-y-1">
                {ids.map((id) => (
                    <PersonChip key={id} id={id} />
                ))}
            </div>
        </div>
    );
}
