import { createLazyFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '@/features/settings/SettingsPage';

export const Route = createLazyFileRoute('/settings')({
    component: SettingsPage,
});
