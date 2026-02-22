import { createLazyFileRoute } from '@tanstack/react-router';

export const Route = createLazyFileRoute('/people/')({
    component: PeopleBrowse,
});

function PeopleBrowse() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-4">People</h1>
            <p className="text-muted-foreground">Browse all people in the graph.</p>
        </div>
    );
}
