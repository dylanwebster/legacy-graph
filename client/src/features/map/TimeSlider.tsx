import { useEffect, useState } from 'react';
import { Play, Pause, Repeat, Clock } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { Button } from '@/shared/ui/button';
import { useTimeStore } from './timeStore';
import { useMapPrefsStore } from './prefsStore';
import type { Granularity, Speed } from './types';

const GRANULARITY_WIDTH: Record<Granularity, number> = {
    year: 5,
    decade: 20,
    century: 100,
};

/** Milliseconds of wall time the playback takes per 1 unit of the chosen granularity at 1× speed. */
const MS_PER_UNIT: Record<Granularity, number> = {
    year: 2000,
    decade: 1000,
    century: 800,
};

export function TimeSlider() {
    const { windowStart, windowEnd, extentStart, extentEnd, showUndated, isPlaying, setWindow, setShowUndated, setPlaying } = useTimeStore();
    const { granularity, speed, loop, setGranularity, setSpeed, setLoop } = useMapPrefsStore();

    // Drag state is purely local — the parent never re-renders during a drag.
    // We commit to the Zustand store only on pointer release (onValueCommit).
    // This is what makes the slider feel snappy: a heatmap framebuffer rebuild
    // per animation frame is the worst case we want to avoid.
    const [drag, setDrag] = useState<[number, number] | null>(null);

    // Step-wise playback — one `granularity` unit per interval. Keeps layer rebuilds
    // down to a few per second (not 60/s) even with tens of thousands of events.
    useEffect(() => {
        if (!isPlaying) return;
        const stepYears = GRANULARITY_WIDTH[granularity];
        const stepMs = MS_PER_UNIT[granularity] / speed;
        const id = setInterval(() => {
            const { windowStart: ws, windowEnd: we, extentStart: es, extentEnd: ee } = useTimeStore.getState();
            const width = we - ws;
            let nextStart = ws + stepYears;
            let nextEnd = nextStart + width;
            if (nextEnd > ee) {
                if (loop) {
                    nextStart = es;
                    nextEnd = nextStart + width;
                } else {
                    setWindow(ee - width, ee);
                    setPlaying(false);
                    return;
                }
            }
            setWindow(nextStart, nextEnd);
        }, stepMs);
        return () => clearInterval(id);
    }, [isPlaying, granularity, speed, loop, setWindow, setPlaying]);

    // Keyboard: Space toggles play, ←/→ shift the window by one granularity unit
    // (Shift = ×10). Modifier-free arrows so they don't conflict with sidebar nav.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
            const step = e.shiftKey ? GRANULARITY_WIDTH[granularity] * 10 : GRANULARITY_WIDTH[granularity];
            if (e.key === ' ') {
                e.preventDefault();
                setPlaying(!isPlaying);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setWindow(windowStart + step, windowEnd + step);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setWindow(windowStart - step, windowEnd - step);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [granularity, isPlaying, windowStart, windowEnd, setPlaying, setWindow]);

    function handleValueChange(values: number[]) {
        if (values.length !== 2) return;
        // Local visual state only — does not trigger a parent re-render.
        setDrag([values[0], values[1]]);
    }

    function handleValueCommit(values: number[]) {
        if (values.length !== 2) return;
        setDrag(null);
        setWindow(values[0], values[1]);
    }

    function handlePointerDown() {
        // Pause playback while the user is interacting; do not auto-resume.
        if (isPlaying) setPlaying(false);
    }

    const value: [number, number] = drag ?? [windowStart, windowEnd];
    const stepYears = GRANULARITY_WIDTH[granularity];

    return (
        <div className="absolute left-4 right-4 bottom-4 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[640px] rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setPlaying(!isPlaying)} aria-label={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                    variant={loop ? 'secondary' : 'ghost'}
                    size="icon"
                    onClick={() => setLoop(!loop)}
                    aria-label="Loop"
                >
                    <Repeat className="h-4 w-4" />
                </Button>
                <label
                    className="flex items-center gap-1 text-[11px] text-muted-foreground"
                    title="Step: how far each playback tick and arrow key advances the window. Also snaps the slider thumbs."
                >
                    <span className="hidden sm:inline">Step</span>
                    <select
                        className="text-xs bg-background border border-border rounded px-2 py-1"
                        value={granularity}
                        onChange={(e) => setGranularity(e.target.value as Granularity)}
                        aria-label="Step (granularity)"
                    >
                        <option value="year">1 yr</option>
                        <option value="decade">10 yr</option>
                        <option value="century">100 yr</option>
                    </select>
                </label>
                <select
                    className="text-xs bg-background border border-border rounded px-2 py-1"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
                    aria-label="Speed"
                    title="Playback speed multiplier"
                >
                    <option value="0.5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                </select>
                <div className="flex-1" />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input type="checkbox" className="h-3 w-3" checked={showUndated} onChange={(e) => setShowUndated(e.target.checked)} />
                    <Clock className="h-3 w-3" /> Show undated
                </label>
            </div>
            <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground w-12 tabular-nums">{Math.round(value[0])}</span>
                <SliderPrimitive.Root
                    className="relative flex flex-1 touch-none select-none items-center h-5"
                    min={extentStart}
                    max={extentEnd}
                    step={stepYears}
                    minStepsBetweenThumbs={1}
                    value={[value[0], value[1]]}
                    onValueChange={handleValueChange}
                    onValueCommit={handleValueCommit}
                    onPointerDown={handlePointerDown}
                    aria-label="Time window"
                >
                    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
                        <SliderPrimitive.Range className="absolute h-full bg-primary" />
                    </SliderPrimitive.Track>
                    <SliderPrimitive.Thumb
                        className="block h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        aria-label="Window start year"
                    />
                    <SliderPrimitive.Thumb
                        className="block h-4 w-4 rounded-full border-2 border-primary bg-background shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        aria-label="Window end year"
                    />
                </SliderPrimitive.Root>
                <span className="font-mono text-xs text-muted-foreground w-12 text-right tabular-nums">{Math.round(value[1])}</span>
            </div>
        </div>
    );
}
