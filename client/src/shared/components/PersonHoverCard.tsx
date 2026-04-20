import { usePerson } from '@/shared/api/hooks';
import type { GraphNodeData, GraphLinkData } from '@/shared/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { PersonCardBody, lifeLine, resolveSpouseLabel } from '@/shared/components/PersonPreviewCard';
import { deriveName } from '@/shared/components/PersonChip';

/**
 * Fetches person data and renders a compact PersonCardBody (no action buttons).
 * Used as the shared hover card content throughout the app.
 *
 * Graph data (for spouse resolution) is read from the TanStack Query cache only —
 * opening a hover card never triggers a /api/graph network request.
 */
export function PersonHoverCard({ id }: { id: string }) {
    const { data: person } = usePerson(id);
    const queryClient = useQueryClient();
    // Read graph data from cache without scheduling a fetch. If not yet loaded,
    // spouse resolution is skipped gracefully.
    const graphData = queryClient.getQueryData<{ nodes: GraphNodeData[]; links: GraphLinkData[] }>(['graphData']);

    if (!person) {
        return <div className="text-xs text-muted-foreground">Loading...</div>;
    }

    const events = (person.events ?? []) as Array<Record<string, unknown>>;
    const birthEvent = events.find(e => e['type'] === 'birth');
    const deathEvent = events.find(e => e['type'] === 'death');

    const parseYear = (date: unknown): number | null => {
        if (typeof date !== 'string') return null;
        const m = date.match(/\d{4}/);
        return m ? parseInt(m[0], 10) : null;
    };

    const parsePlace = (location: unknown): string | null => {
        if (!location) return null;
        if (typeof location === 'string') return location || null;
        if (typeof location === 'object' && location !== null) {
            const loc = location as Record<string, unknown>;
            return typeof loc['name'] === 'string' ? loc['name'] || null : null;
        }
        return null;
    };

    const birthYear = parseYear(birthEvent?.['date']);
    const birthPlace = parsePlace(birthEvent?.['location']);
    const deathYear = parseYear(deathEvent?.['date']);
    const deathPlace = parsePlace(deathEvent?.['location']);

    const graphNodeMap = graphData
        ? new Map(graphData.nodes.map(n => [n.id, n as GraphNodeData]))
        : new Map<string, GraphNodeData>();
    const spouseLabel = graphData
        ? resolveSpouseLabel(id, graphData.links, graphNodeMap)
        : null;

    return (
        <PersonCardBody
            personId={id}
            label={deriveName(person)}
            sex={person.sex ?? 'U'}
            primaryAsset={person.assets?.[0] ?? null}
            birthLine={lifeLine('b. ', birthYear, birthPlace)}
            deathLine={lifeLine('d. ', deathYear, deathPlace)}
            spouseLabel={spouseLabel}
        />
    );
}
