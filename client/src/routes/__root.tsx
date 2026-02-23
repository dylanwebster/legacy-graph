import { createRootRoute, Outlet } from '@tanstack/react-router';
import { HydrationProgress } from '@/components/HydrationProgress';
import { ErrorFallback } from '@/components/ErrorFallback';
import { GlobalNotFound } from '@/components/GlobalNotFound';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { CommandPalette } from '@/components/CommandPalette';

export const Route = createRootRoute({
    component: () => (
        <>
            <HydrationProgress />
            <CommandPalette />
            <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
                <Sidebar />

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 h-full relative">
                    <TopBar />

                    {/* Page Content */}
                    <main className="flex-1 overflow-hidden bg-muted/20">
                        <Outlet />
                    </main>
                </div>
            </div>
        </>
    ),
    errorComponent: ({ error, reset }) => <ErrorFallback error={error as Error} reset={reset} />,
    notFoundComponent: () => <GlobalNotFound />,
});
