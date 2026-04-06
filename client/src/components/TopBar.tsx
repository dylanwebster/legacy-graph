import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useRouterState } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { useTopBarSlotSetter } from '@/components/TopBarSlotContext';

function usePageTitle(): string {
    const { location } = useRouterState();
    const path = location.pathname;
    if (path === '/') return 'Graph';
    if (path.startsWith('/people')) return 'People';
    if (path.startsWith('/stories')) return 'Stories';
    if (path.startsWith('/assets')) return 'Assets';
    if (path.startsWith('/map')) return 'Map';
    if (path.startsWith('/import')) return 'Import';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/search')) return 'Search';
    return 'LegacyGraph';
}

export function TopBar() {
    const { sidebarOpen, toggleSidebar } = useUIStore();
    const pageTitle = usePageTitle();
    const setSlotEl = useTopBarSlotSetter();

    return (
        <div className="flex h-14 items-center border-b border-border bg-background px-4 shrink-0 gap-2">
            {/* Mobile only: sidebar toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="shrink-0 md:hidden"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
                aria-expanded={sidebarOpen}
            >
                {sidebarOpen
                    ? <ChevronLeft className="h-5 w-5" />
                    : <ChevronRight className="h-5 w-5" />
                }
            </Button>
            <img src="/lg.svg" alt="LegacyGraph" className="h-8 w-8 shrink-0" />
            <span className="text-base font-semibold text-foreground shrink-0">{pageTitle}</span>
            {/* Page-specific actions injected here via TopBarActions portal */}
            <div ref={setSlotEl} className="flex-1 flex items-center gap-2 min-w-0" />
        </div>
    );
}
