import { useEffect, useState, useRef } from 'react';
import { useSystemStatus } from '@/api/hooks';

type HydrationState = {
    status: 'connecting' | 'loading' | 'ready' | 'error' | 'dismissed';
    phase?: string;
    percent?: number;
    loaded?: number;
    total?: number;
    error?: string;
};

export function HydrationProgress() {
    const [state, setState] = useState<HydrationState>({ status: 'connecting' });
    const retriesRef = useRef(0);
    const maxRetries = 3;

    // Also poll system status as a fallback — if it reports 'ready', dismiss the overlay
    const { data: systemStatus } = useSystemStatus();

    useEffect(() => {
        if (systemStatus?.hydrationState === 'ready' && state.status !== 'ready') {
            setState({ status: 'ready' });
        }
    }, [systemStatus, state.status]);

    useEffect(() => {
        const evtSource = new EventSource('/api/system/hydration/stream');

        evtSource.addEventListener('progress', (e) => {
            try {
                const data = JSON.parse(e.data);
                retriesRef.current = 0;
                setState({
                    status: 'loading',
                    phase: data.phase,
                    percent: data.percent,
                    loaded: data.loaded,
                    total: data.total
                });
            } catch {
                // Ignore parse error
            }
        });

        evtSource.addEventListener('complete', () => {
            setState({ status: 'ready' });
            evtSource.close();
        });

        // Named 'error' event from the server (hydration failed)
        evtSource.addEventListener('error', (e) => {
            const msgEvent = e as MessageEvent;
            try {
                if (msgEvent.data) {
                    const data = JSON.parse(msgEvent.data);
                    setState({ status: 'error', error: data.message });
                    evtSource.close();
                }
                // No data means a transient connection issue; let EventSource auto-reconnect
            } catch {
                // Not a server-sent error event, ignore
            }
        });

        // Browser-level connection error (backend offline, network failure)
        evtSource.onerror = () => {
            retriesRef.current += 1;
            if (retriesRef.current >= maxRetries) {
                // After max retries, dismiss gracefully instead of blocking the UI
                setState({ status: 'dismissed' });
                evtSource.close();
            }
            // Otherwise EventSource auto-reconnects
        };

        return () => {
            evtSource.close();
        };
    }, []);

    // Don't render if hydration is complete, dismissed, or still just connecting
    if (state.status === 'ready' || state.status === 'dismissed') return null;
    // Also don't show the overlay if we're just 'connecting' and systemStatus says ready
    if (state.status === 'connecting' && systemStatus?.hydrationState === 'ready') return null;
    // Don't show overlay at all unless we actually have loading progress or an error
    if (state.status === 'connecting') return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-md p-6 bg-card border border-border rounded-xl shadow-lg flex flex-col gap-4">
                <h2 className="text-xl font-bold tracking-tight">Initializing LegacyGraph</h2>

                {state.status === 'error' ? (
                    <div className="text-destructive font-medium border-l-4 border-destructive pl-4 py-2">
                        <div>Error starting graph engine:</div>
                        <div className="text-sm mt-1">{state.error}</div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-sm text-muted-foreground font-medium">
                            <span>{state.phase || 'Loading graph...'}</span>
                            {state.percent !== undefined && <span>{Math.round(state.percent)}%</span>}
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300 ease-out"
                                style={{ width: `${state.percent || 0}%` }}
                            />
                        </div>
                        {state.loaded !== undefined && state.total !== undefined && (
                            <div className="text-xs text-muted-foreground text-right">
                                {state.loaded} / {state.total} files
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
