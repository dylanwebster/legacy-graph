import { createLazyFileRoute } from '@tanstack/react-router';
import { StoryDetailPage } from '@/features/stories/StoryDetailPage';

export const Route = createLazyFileRoute('/stories/$id')({
    component: StoryDetailRoute,
});

function StoryDetailRoute() {
    const { id } = Route.useParams();
    return <StoryDetailPage id={id} />;
}
