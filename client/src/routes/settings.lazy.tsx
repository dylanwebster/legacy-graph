import { createLazyFileRoute } from '@tanstack/react-router';

export const Route = createLazyFileRoute('/settings')({
    component: SettingsPage,
});

function SettingsPage() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold mb-4">Settings</h1>
        </div>
    );
}
