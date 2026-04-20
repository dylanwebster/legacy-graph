import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/button';

export function GlobalNotFound() {
    return (
        <div className="p-8 flex flex-col items-center justify-center h-full w-full text-center gap-4 animate-in fade-in duration-300">
            <div className="space-y-2">
                <h2 className="text-6xl font-black text-muted tracking-tighter">404</h2>
                <p className="text-2xl font-bold tracking-tight">Page not found</p>
                <p className="text-muted-foreground max-w-md mx-auto mt-2">
                    The requested route doesn't exist or you don't have permission to view it.
                </p>
            </div>
            <Button asChild size="lg" className="mt-6">
                <Link to="/">Return to Dashboard</Link>
            </Button>
        </div>
    );
}
