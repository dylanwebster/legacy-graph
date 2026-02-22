import { createLazyFileRoute } from '@tanstack/react-router';

export const Route = createLazyFileRoute('/search')({
    component: SearchPage,
});

function SearchPage() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-4">Search Results</h1>
        </div>
    );
}
