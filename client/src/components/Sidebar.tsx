import { Link } from '@tanstack/react-router';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import { StatusDot } from './StatusDot';
import { Share2, Users, BookOpen, Image, Import, Settings, ChevronLeft, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function LGLogo({ className }: { className?: string }) {
    return <img src="/lg.svg" alt="LegacyGraph" className={className} />;
}

const navItems = [
    { icon: Share2, label: 'Graph', to: '/' },
    { icon: Users, label: 'People', to: '/people' },
    { icon: BookOpen, label: 'Stories', to: '/stories' },
    { icon: Image, label: 'Assets', to: '/assets' },
    { icon: Import, label: 'Import GEDCOM', to: '/import' },
];

const bottomItems = [
    { icon: Settings, label: 'Settings', to: '/settings' },
];

export function Sidebar() {
    const { sidebarOpen, toggleSidebar } = useUIStore();

    return (
        <>
            {/* Mobile backdrop — click outside to close */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/25 z-10 md:hidden"
                    onClick={toggleSidebar}
                    aria-hidden="true"
                />
            )}

            <div
                className={cn(
                    "flex flex-col h-full bg-card border-r border-border transition-all duration-300 z-20 shrink-0",
                    sidebarOpen ? "w-64 absolute md:relative shadow-xl md:shadow-none" : "w-16 hidden md:flex"
                )}
            >
                {/* Header */}
                <div className="flex h-14 items-center border-b border-border shrink-0">
                    {sidebarOpen ? (
                        <>
                            {/* Mobile: X on the left */}
                            <button
                                onClick={toggleSidebar}
                                className="md:hidden flex items-center justify-center h-9 w-9 ml-2.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                                aria-label="Close sidebar"
                            >
                                <X className="h-5 w-5" />
                            </button>
                            {/* Logo + wordmark — links to Dashboard */}
                            <Link
                                to="/"
                                className="flex items-center gap-2 flex-1 pl-2 md:pl-3 min-w-0"
                                aria-label="LegacyGraph — Dashboard"
                            >
                                <LGLogo className="h-7 w-7 shrink-0" />
                                <span className="font-bold text-base tracking-tight truncate">LegacyGraph</span>
                            </Link>
                            {/* Desktop: ChevronLeft on the right */}
                            <button
                                onClick={toggleSidebar}
                                className="hidden md:flex items-center justify-center h-7 w-7 mr-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                                aria-label="Collapse sidebar"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                        </>
                    ) : (
                        /* Desktop collapsed: logo icon centered, toggles sidebar open */
                        <TooltipProvider delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={toggleSidebar}
                                        className="mx-auto flex items-center justify-center rounded-md transition-colors"
                                        aria-label="Expand sidebar"
                                    >
                                        <LGLogo className="h-8 w-8" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="right">LegacyGraph</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>

                {/* Nav items */}
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

                {/* Bottom settings */}
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

                {/* Footer: system status (no longer a toggle) */}
                <div className="flex h-14 items-center justify-center border-t border-border shrink-0">
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
        </>
    );
}
