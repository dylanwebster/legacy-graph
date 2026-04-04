import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { HydrationProgress } from '@/components/HydrationProgress';
import { ErrorFallback } from '@/components/ErrorFallback';
import { GlobalNotFound } from '@/components/GlobalNotFound';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { CommandPalette } from '@/components/CommandPalette';
import { TopBarSlotProvider } from '@/components/TopBarSlotContext';

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
