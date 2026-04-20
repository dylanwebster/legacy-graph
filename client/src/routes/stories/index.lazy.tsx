import { createLazyFileRoute } from '@tanstack/react-router';
import { StoriesListPage } from '@/features/stories/StoriesListPage';

export const Route = createLazyFileRoute('/stories/')({
    component: StoriesListPage,
});
