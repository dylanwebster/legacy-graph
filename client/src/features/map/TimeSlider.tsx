import { memo, useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, Clock } from 'lucide-react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';
import { useTimeStore, advanceWindow, STEP_YEARS, type YearHistogram } from './timeStore';
import { useMapPrefsStore } from './prefsStore';
import type { Granularity, Speed } from './types';

/** Milliseconds of wall time the playback takes per step at 1× speed. */
const MS_PER_STEP: Record<Granularity, number> = {
    year: 2000,
    decade: 1000,
    century: 800,
};

interface TimeSliderProps {
    /** Event-count context strip rendered behind the slider track. */
    histogram: YearHistogram;
}

// memo: MapView re-renders on every quantized zoom notch; the slider's props
// (the memoized histogram) are stable across those, and it subscribes to the
// time/prefs stores itself — so parent renders never need to reach it.
export const TimeSlider = memo(function TimeSlider({ histogram }: TimeSliderProps) {
    const { windowStart, windowEnd, extentStart, extentEnd, showUndated, isPlaying, setWindow, setShowUndated, setPlaying } = useTimeStore();
    const { granularity, speed, loop, setGranularity, setSpeed, setLoop } = useMapPrefsStore();

    // Local drag state keeps the thumbs glued to the pointer; the store is
    // updated live during the drag, rAF-throttled. Live updates are affordable
    // because the time window is a GPU filter uniform (see buildMapLayers) —
    // a window change re-runs one GPU pass, not a data rebuild.
    const [drag, setDrag] = useState<[number, number] | null>(null);
    const dragRaf = useRef<number | null>(null);
    const pendingDrag = useRef<[number, number] | null>(null);
    useEffect(() => () => {
        if (dragRaf.current !== null) cancelAnimationFrame(dragRaf.current);
    }, []);

    // Step-wise playback — one STEP_YEARS unit per interval, clamped to the
    // window width inside advanceWindow so playback never skips years.
    useEffect(() => {
        if (!isPlaying) return;
        const stepMs = MS_PER_STEP[granularity] / speed;
        const id = setInterval(() => {
            const { windowStart: ws, windowEnd: we, extentStart: es, extentEnd: ee } = useTimeStore.getState();
            const next = advanceWindow(ws, we, es, ee, STEP_YEARS[granularity], loop);
            setWindow(next.windowStart, next.windowEnd);
            if (next.done) setPlaying(false);
        }, stepMs);
        return () => clearInterval(id);
    }, [isPlaying, granularity, speed, loop, setWindow, setPlaying]);

    // Keyboard: Space toggles play, ←/→ shift the window by one step
    // (Shift = ×10). Skipped when focus is on a form control or a slider
    // thumb — buttons/selects own Space/arrows natively, and Radix handles
    // arrow keys on its own thumbs (per-thumb, 1-yr steps).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.isContentEditable ||
                    target.closest('input, textarea, select, button, [role="slider"]'))
            ) {
                return;
            }
            const step = (e.shiftKey ? 10 : 1) * STEP_YEARS[granularity];
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
        const next: [number, number] = [values[0], values[1]];
        setDrag(next);
        // Push to the store at most once per frame so the map scrubs live.
        pendingDrag.current = next;
        if (dragRaf.current === null) {
            dragRaf.current = requestAnimationFrame(() => {
                dragRaf.current = null;
                const p = pendingDrag.current;
                if (p) setWindow(p[0], p[1]);
            });
        }
    }

    function handleValueCommit(values: number[]) {
        if (values.length !== 2) return;
        if (dragRaf.current !== null) {
            cancelAnimationFrame(dragRaf.current);
            dragRaf.current = null;
        }
        pendingDrag.current = null;
        setDrag(null);
        setWindow(values[0], values[1]);
    }

    function handlePointerDown() {
        // Pause playback while the user is interacting; do not auto-resume.
        if (isPlaying) setPlaying(false);
    }

    const value: [number, number] = drag ?? [windowStart, windowEnd];
    const width = Math.round(value[1]) - Math.round(value[0]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="absolute left-4 right-4 bottom-4 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[640px] rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => setPlaying(!isPlaying)} aria-label={isPlaying ? 'Pause' : 'Play'}>
                        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant={loop ? 'secondary' : 'ghost'}
                                size="icon"
                                onClick={() => setLoop(!loop)}
                                aria-label="Loop"
                            >
                                <Repeat className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Loop playback back to the start</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <span className="hidden sm:inline">Step</span>
                                <select
                                    className="text-xs bg-background border border-border rounded px-2 py-1"
                                    value={granularity}
                                    onChange={(e) => setGranularity(e.target.value as Granularity)}
                                    aria-label="Step size"
                                >
                                    <option value="year">1 yr</option>
                                    <option value="decade">10 yr</option>
                                    <option value="century">100 yr</option>
                                </select>
                            </label>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            How far each playback tick and ←/→ key moves the window
                        </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <span className="hidden sm:inline">Speed</span>
                                <select
                                    className="text-xs bg-background border border-border rounded px-2 py-1"
                                    value={speed}
                                    onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
                                    aria-label="Playback speed"
                                >
                                    <option value="0.5">0.5×</option>
                                    <option value="1">1×</option>
                                    <option value="2">2×</option>
                                    <option value="4">4×</option>
                                </select>
                            </label>
                        </TooltipTrigger>
                        <TooltipContent side="top">Playback speed multiplier</TooltipContent>
                    </Tooltip>
                    <div className="flex-1" />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                                <input type="checkbox" className="h-3 w-3" checked={showUndated} onChange={(e) => setShowUndated(e.target.checked)} />
                                <Clock className="h-3 w-3" /> Show undated
                            </label>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            Also show events without a date, regardless of the window
                        </TooltipContent>
                    </Tooltip>
                </div>
                <div className="flex items-end gap-3">
                    <span className="font-mono text-[10px] text-muted-foreground/70 w-12 tabular-nums pb-1">
                        {Math.round(extentStart)}
                    </span>
                    <div className="flex-1 min-w-0">
                        {/* Event-count context strip. sqrt scaling + a minimum bar
                            height keep sparse bins visible next to dense ones —
                            genealogy data is heavily skewed toward a few decades.
                            px-2 aligns the strip with the thumb centers (half the
                            16 px thumb width). Purely contextual: no axes, no
                            hover — the slider is the interaction. */}
                        <div className="flex items-end gap-px h-6 px-2" aria-hidden>
                            {histogram.counts.map((count, i) => (
                                <div
                                    key={i}
                                    className="flex-1 rounded-t-[1px] bg-muted-foreground/25"
                                    style={{
                                        height:
                                            count > 0 && histogram.max > 0
                                                ? `${Math.max(8, Math.sqrt(count / histogram.max) * 100)}%`
                                                : '0%',
                                    }}
                                />
                            ))}
                        </div>
                        <SliderPrimitive.Root
                            className="relative flex touch-none select-none items-center h-5"
                            min={extentStart}
                            max={extentEnd}
                            step={1}
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
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground/70 w-12 text-right tabular-nums pb-1">
                        {Math.round(extentEnd)}
                    </span>
                </div>
                <div className="text-center font-mono text-xs tabular-nums">
                    {Math.round(value[0])} – {Math.round(value[1])}
                    <span className="text-muted-foreground"> · {width} {width === 1 ? 'yr' : 'yrs'}</span>
                </div>
            </div>
        </TooltipProvider>
    );
});
