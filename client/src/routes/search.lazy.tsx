import { createLazyFileRoute } from '@tanstack/react-router';
import { SearchPage } from '@/features/search/SearchPage';

export const Route = createLazyFileRoute('/search')({
    component: SearchPage,
});
