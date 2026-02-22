import { createLazyFileRoute } from '@tanstack/react-router';

export const Route = createLazyFileRoute('/import')({
    component: ImportPage,
});

function ImportPage() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-4">Import GEDCOM</h1>
        </div>
    );
}
