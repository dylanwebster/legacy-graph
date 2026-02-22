import { useEffect, useState } from 'react';

type HydrationState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    phase?: string;
    percent?: number;
    loaded?: number;
    total?: number;
    error?: string;
};

export function HydrationProgress() {
    const [state, setState] = useState<HydrationState>({ status: 'idle' });

    useEffect(() => {
        setState({ status: 'loading' });
        const evtSource = new EventSource('/api/system/hydration/stream');

        evtSource.addEventListener('progress', (e) => {
            try {
                const data = JSON.parse(e.data);
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

        evtSource.addEventListener('error', (e: MessageEvent) => {
            try {
                if (e.data) {
                    const data = JSON.parse(e.data);
                    setState({ status: 'error', error: data.message });
                } else {
                    setState({ status: 'error', error: 'Connection lost to the server.' });
                }
            } catch {
                setState({ status: 'error', error: 'Stream connection error.' });
            }
            evtSource.close();
        });

        return () => {
            evtSource.close();
        };
    }, []);

    if (state.status !== 'loading' && state.status !== 'error') return null;

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
                            <span>{state.phase || 'Connecting...'}</span>
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
