import { createLazyFileRoute } from '@tanstack/react-router';

export const Route = createLazyFileRoute('/people/$id')({
    component: PersonDetail,
});

function PersonDetail() {
    const { id } = Route.useParams();

    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-4">Person Detail</h1>
            <p className="text-muted-foreground">ID: {id}</p>
        </div>
    );
}
