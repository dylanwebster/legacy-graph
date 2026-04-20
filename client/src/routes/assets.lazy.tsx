import { createLazyFileRoute } from '@tanstack/react-router';
import { AssetsPage } from '@/features/assets/AssetsPage';

export const Route = createLazyFileRoute('/assets')({
    component: AssetsPage,
});
