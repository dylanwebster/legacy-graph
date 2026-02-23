import { Link } from '@tanstack/react-router';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import { StatusDot } from './StatusDot';
import { LayoutDashboard, Users, Import, Settings, ArrowLeftRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', to: '/' },
    { icon: Users, label: 'People', to: '/people' },
    { icon: Import, label: 'Import GEDCOM', to: '/import' },
];

const bottomItems = [
    { icon: Settings, label: 'Settings', to: '/settings' },
];

export function Sidebar() {
    const { sidebarOpen, toggleSidebar } = useUIStore();

    return (
        <div
            className={cn(
                "flex flex-col h-full bg-card border-r border-border transition-all duration-300 z-20 shrink-0",
                sidebarOpen ? "w-64 absolute md:relative shadow-xl md:shadow-none" : "w-16 hidden md:flex"
            )}
        >
            <div className="flex h-14 items-center justify-between border-b border-border px-4 tracking-tight">
                <span className={cn("font-bold text-lg", !sidebarOpen && "mx-auto")}>
                    {sidebarOpen ? 'LegacyGraph' : 'LG'}
                </span>
                {sidebarOpen && (
                    <button onClick={toggleSidebar} className="md:hidden p-1 text-muted-foreground hover:bg-muted hover:text-foreground rounded">
                        <ArrowLeftRight className="h-4 w-4" />
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col py-4 px-2 gap-2 overflow-y-auto">
                <TooltipProvider delayDuration={0}>
                    {navItems.map((item) => (
                        <Tooltip key={item.to}>
                            <TooltipTrigger asChild>
                                <Link
                                    to={item.to}
                                    className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 [&.active]:bg-primary/10 [&.active]:text-primary"
                                    onClick={() => window.innerWidth < 768 && sidebarOpen && toggleSidebar()}
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
                                </Link>
                            </TooltipTrigger>
                            {!sidebarOpen && <TooltipContent side="right">{item.label}</TooltipContent>}
                        </Tooltip>
                    ))}
                </TooltipProvider>
            </div>

            <div className="flex flex-col py-4 px-2 gap-2 border-t border-border">
                <TooltipProvider delayDuration={0}>
                    {bottomItems.map((item) => (
                        <Tooltip key={item.to}>
                            <TooltipTrigger asChild>
                                <Link
                                    to={item.to}
                                    className="flex items-center gap-3 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 [&.active]:bg-primary/10 [&.active]:text-primary"
                                    onClick={() => window.innerWidth < 768 && sidebarOpen && toggleSidebar()}
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {sidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
                                </Link>
                            </TooltipTrigger>
                            {!sidebarOpen && <TooltipContent side="right">{item.label}</TooltipContent>}
                        </Tooltip>
                    ))}
                </TooltipProvider>
            </div>

            <div className="flex h-14 items-center justify-center border-t border-border shrink-0 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => window.innerWidth >= 768 && toggleSidebar()}>
                {sidebarOpen ? (
                    <div className="flex items-center justify-between w-full px-4">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System</span>
                        <StatusDot />
                    </div>
                ) : (
                    <StatusDot />
                )}
            </div>
        </div>
    );
}
