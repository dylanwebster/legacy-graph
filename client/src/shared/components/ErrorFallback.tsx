import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/button';
import { AlertTriangle } from 'lucide-react';

export function ErrorFallback({ error, reset }: { error: Error; reset?: () => void }) {
    return (
        <div className="p-8 flex flex-col items-center justify-center h-full w-full text-center gap-4 animate-in fade-in duration-300">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
                <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Something went wrong</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                    {error.message || 'An unexpected error occurred while loading this view.'}
                </p>
            </div>
            <div className="flex items-center gap-4 mt-6">
                {reset && (
                    <Button onClick={reset} variant="outline" size="lg">
                        Try again
                    </Button>
                )}
                <Button asChild size="lg">
                    <Link to="/">Return to Dashboard</Link>
                </Button>
            </div>
        </div>
    );
}
