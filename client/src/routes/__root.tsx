import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { HydrationProgress } from '@/shared/components/HydrationProgress';
import { ErrorFallback } from '@/shared/components/ErrorFallback';
import { GlobalNotFound } from '@/shared/components/GlobalNotFound';
import { Sidebar } from '@/shared/components/layout/Sidebar';
import { TopBar } from '@/shared/components/layout/TopBar';
import { CommandPalette } from '@/features/search/CommandPalette';
import { TopBarSlotProvider } from '@/shared/components/layout/TopBarSlotContext';

export const Route = createRootRoute({
    component: () => (
        <TopBarSlotProvider>
            <Toaster richColors position="bottom-right" />
            <HydrationProgress />
            <CommandPalette />
            <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
                <Sidebar />

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 h-full relative">
                    <TopBar />

                    {/* Page Content */}
                    <main className="flex-1 h-full overflow-hidden bg-muted/20">
                        <Outlet />
                    </main>
                </div>
            </div>
        </TopBarSlotProvider>
    ),
    errorComponent: ({ error, reset }) => <ErrorFallback error={error as Error} reset={reset} />,
    notFoundComponent: () => <GlobalNotFound />,
});
