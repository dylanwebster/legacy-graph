import { Menu, Search, Sun, Moon } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/button';

export function TopBar() {
    const { sidebarOpen, toggleSidebar, setSearchOpen, theme, toggleTheme } = useUIStore();

    return (
        <div className="flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:px-6 z-10 w-full shrink-0">
            <div className="flex items-center gap-3">
                {/* Mobile: hamburger opens the sidebar. Hidden on desktop. */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden shrink-0"
                    onClick={toggleSidebar}
                    aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
                    aria-expanded={sidebarOpen}
                >
                    <Menu className="h-5 w-5" />
                </Button>

                {/* Mobile: "LG" brand shown when sidebar is closed */}
                {!sidebarOpen && (
                    <span className="md:hidden font-bold text-base tracking-tight select-none">LG</span>
                )}

            </div>

            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    className="w-full justify-start text-sm text-muted-foreground sm:w-64 pr-2 hover:bg-muted/50 transition-colors"
                    onClick={() => setSearchOpen(true)}
                >
                    <Search className="mr-2 h-4 w-4 shrink-0" />
                    <span className="hidden lg:inline-flex">Search people & families...</span>
                    <span className="inline-flex lg:hidden">Search...</span>
                    <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                    {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
            </div>
        </div>
    );
}
