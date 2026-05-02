import { useEffect, useRef } from 'react';
import { Play, Pause, Repeat, Clock } from 'lucide-react';
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
    const scrubRef = useRef<{ wasPlayingBeforeScrub: boolean }>({ wasPlayingBeforeScrub: false });

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

    // Keyboard: Space / ← → / Shift+← →
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
            const step = e.shiftKey ? GRANULARITY_WIDTH[granularity] * 10 : GRANULARITY_WIDTH[granularity];
            if (e.key === ' ') { e.preventDefault(); setPlaying(!isPlaying); }
            else if (e.key === 'ArrowRight') {
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

    function onScrubStart() {
        scrubRef.current.wasPlayingBeforeScrub = isPlaying;
        if (isPlaying) setPlaying(false);
    }
    function onScrubEnd() {
        // Explicit user scrub — do NOT auto-resume.
        scrubRef.current.wasPlayingBeforeScrub = false;
    }

    const width = windowEnd - windowStart;

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
                <select
                    className="text-xs bg-background border border-border rounded px-2 py-1"
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as Granularity)}
                >
                    <option value="year">Year</option>
                    <option value="decade">Decade</option>
                    <option value="century">Century</option>
                </select>
                <select
                    className="text-xs bg-background border border-border rounded px-2 py-1"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
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
                <span className="font-mono text-xs text-muted-foreground w-12">{Math.round(windowStart)}</span>
                <input
                    className="flex-1"
                    type="range"
                    min={extentStart}
                    max={extentEnd - width}
                    value={windowStart}
                    onMouseDown={onScrubStart}
                    onTouchStart={onScrubStart}
                    onMouseUp={onScrubEnd}
                    onTouchEnd={onScrubEnd}
                    onChange={(e) => {
                        const s = Number(e.target.value);
                        setWindow(s, s + width);
                    }}
                />
                <span className="font-mono text-xs text-muted-foreground w-12 text-right">{Math.round(windowEnd)}</span>
            </div>
        </div>
    );
}
