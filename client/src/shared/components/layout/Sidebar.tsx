import { Link } from '@tanstack/react-router';
import { Network, Users, BookOpen, Image, Settings, Search, Globe } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';
import { useUIStore } from '@/shared/store/uiStore';
import { cn } from '@/shared/lib/cn';

const navItems = [
    { icon: Network, label: 'Graph', to: '/' },
    { icon: Globe, label: 'Map', to: '/map' },
    { icon: Users, label: 'People', to: '/people' },
    { icon: BookOpen, label: 'Stories', to: '/stories' },
    { icon: Image, label: 'Assets', to: '/assets' },
];

const bottomItems = [
    { icon: Settings, label: 'Settings', to: '/settings' },
];

export function Sidebar() {
    const { sidebarOpen, toggleSidebar, setSearchOpen } = useUIStore();

    function handleNavClick() {
        if (window.innerWidth < 768) {
            toggleSidebar();
        }
    }

    return (
        <div className={cn(
            'flex-col w-16 h-full bg-card border-r border-border z-20 shrink-0',
            sidebarOpen ? 'flex' : 'hidden md:flex',
        )}>
            {/* Nav items */}
            <div className="flex-1 flex flex-col py-4 px-2 gap-2 overflow-y-auto">
                <TooltipProvider delayDuration={0}>
                    {navItems.map((item) => (
                        <Tooltip key={item.to}>
                            <TooltipTrigger asChild>
                                <Link
                                    to={item.to}
                                    onClick={handleNavClick}
                                    className="flex items-center justify-center rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 [&.active]:bg-primary/10 [&.active]:text-primary"
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                    ))}
                </TooltipProvider>
            </div>

            {/* Bottom: search + settings */}
            <div className="flex flex-col py-4 px-2 gap-2 border-t border-border">
                <TooltipProvider delayDuration={0}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setSearchOpen(true)}
                                className="flex items-center justify-center rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
                                aria-label="Search"
                            >
                                <Search className="h-5 w-5 shrink-0" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">Search <kbd className="ml-1 font-mono text-[10px]">/</kbd></TooltipContent>
                    </Tooltip>
                    {bottomItems.map((item) => (
                        <Tooltip key={item.to}>
                            <TooltipTrigger asChild>
                                <Link
                                    to={item.to}
                                    onClick={handleNavClick}
                                    className="flex items-center justify-center rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 [&.active]:bg-primary/10 [&.active]:text-primary"
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                    ))}
                </TooltipProvider>
            </div>
        </div>
    );
}
