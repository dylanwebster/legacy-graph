import { createLazyFileRoute } from '@tanstack/react-router';
import { PeopleListPage } from '@/features/people/PeopleListPage';

export const Route = createLazyFileRoute('/people/')({
    component: PeopleListPage,
});
