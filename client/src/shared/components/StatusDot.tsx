import { useSystemStatus } from '@/shared/api/hooks';
import { cn } from '@/shared/lib/cn';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

export function StatusDot({ className }: { className?: string }) {
    const { data, isLoading, isError } = useSystemStatus();

    let statusColor = 'bg-muted';
    let statusText = 'Unknown Status';

    if (isLoading) {
        statusColor = 'bg-amber-500 animate-pulse';
        statusText = 'Connecting to engine...';
    } else if (isError) {
        statusColor = 'bg-red-500';
        statusText = 'Engine offline or error';
    } else if (data?.hydrationState === 'loading') {
        statusColor = 'bg-amber-500 animate-pulse';
        statusText = 'Hydrating graph...';
    } else if (data?.hydrationState === 'ready') {
        statusColor = 'bg-emerald-500';
        statusText = 'Engine online & ready';
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className={cn("flex items-center justify-center p-2 rounded-full hover:bg-muted/50 transition-colors cursor-help", className)}>
                        <div className={cn("h-3 w-3 rounded-full", statusColor)} />
                    </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                    <p className="text-sm font-medium">{statusText}</p>
                    {data?.cacheAge && (
                        <p className="text-xs text-muted-foreground mt-1">
                            Cache written: {new Date(data.cacheAge).toLocaleString()}
                        </p>
                    )}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
