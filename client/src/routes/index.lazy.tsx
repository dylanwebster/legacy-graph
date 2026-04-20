import { createLazyFileRoute } from '@tanstack/react-router';
import { FamilyGraphPanel } from '@/features/dashboard/FamilyGraphPanel';

export const Route = createLazyFileRoute('/')({
    component: FamilyGraphPanel,
});
