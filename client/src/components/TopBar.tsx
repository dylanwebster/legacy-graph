import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';

export function TopBar() {
    const { sidebarOpen, toggleSidebar } = useUIStore();

    return (
        <div className="md:hidden flex h-14 items-center border-b border-border bg-background px-4 shrink-0">
            {/* Mobile: chevron toggle + logo */}
            <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
                aria-expanded={sidebarOpen}
            >
                {sidebarOpen
                    ? <ChevronLeft className="h-5 w-5" />
                    : <ChevronRight className="h-5 w-5" />
                }
            </Button>
            <img src="/lg.svg" alt="LegacyGraph" className="h-8 w-8 ml-1" />
        </div>
    );
}
