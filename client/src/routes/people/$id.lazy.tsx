import { createLazyFileRoute } from '@tanstack/react-router';
import { PersonDetailPage } from '@/features/people/PersonDetailPage';

export const Route = createLazyFileRoute('/people/$id')({
    component: PersonDetailRoute,
});

function PersonDetailRoute() {
    const { id } = Route.useParams();
    return <PersonDetailPage id={id} />;
}
