import { useRef, useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import {
    buildAncestorTree,
    computeFanArcLayout,
    type AncestorSlot,
    type FanArc,
} from '@/utils/genealogyLayout';
import { Network } from 'lucide-react';

// ─── Handle ───────────────────────────────────────────────────────────────────

export interface FanChartPanelHandle {
    resetView: () => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FanChartPanelProps {
    nodes: GraphNodeData[];
    links: GraphLinkData[];
    rootPersonId: string | null;
    maxGen: number;
    onMaxGenChange: (gen: number) => void;
    onRootChange: (id: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_R = 52;
const SEX_COLOR: Record<string, string> = {
    M: '#60a5fa',
    F: '#f472b6',
    I: '#a78bfa',
    U: '#94a3b8',
};

function sexColor(sex: string): string {
    return SEX_COLOR[sex] ?? SEX_COLOR['U'];
}

/** Interpolate hue between blue (paternal, slot 0) and rose (maternal, last slot). */
function lineageColor(slot: AncestorSlot, isDark: boolean): string {
    if (slot.generation === 0) return sexColor(slot.sex);
    const maxSlot = Math.max(1, Math.pow(2, slot.generation) - 1);
    const t = slot.slotIndex / maxSlot;
    const hue = Math.round(220 + t * 120);
    const saturation = 65;
    const lightness = isDark ? 52 : 48;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/** SVG arc path string for a FanArc segment. cx/cy is the fan center. */
function arcPathStr(arc: FanArc, cx: number, cy: number): string {
    const { startAngle: a1, endAngle: a2, innerR: r1, outerR: r2 } = arc;
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);
    const largeArc = a2 - a1 > Math.PI ? 1 : 0;
    return [
        `M ${(cx + r1 * cos1).toFixed(2)} ${(cy + r1 * sin1).toFixed(2)}`,
        `L ${(cx + r2 * cos1).toFixed(2)} ${(cy + r2 * sin1).toFixed(2)}`,
        `A ${r2.toFixed(2)} ${r2.toFixed(2)} 0 ${largeArc} 1 ${(cx + r2 * cos2).toFixed(2)} ${(cy + r2 * sin2).toFixed(2)}`,
        `L ${(cx + r1 * cos2).toFixed(2)} ${(cy + r1 * sin2).toFixed(2)}`,
        `A ${r1.toFixed(2)} ${r1.toFixed(2)} 0 ${largeArc} 0 ${(cx + r1 * cos1).toFixed(2)} ${(cy + r1 * sin1).toFixed(2)}`,
        'Z',
    ].join(' ');
}

/** Angle midpoint for label placement. */
function arcMidAngle(arc: FanArc): number {
    return (arc.startAngle + arc.endAngle) / 2;
}

/** Truncate label to fit inside arc (rough heuristic). */
function shortName(label: string, maxChars = 14): string {
    if (label.length <= maxChars) return label;
    const parts = label.split(' ');
    if (parts.length >= 2) {
        const first = parts[0];
        const lastInitial = parts[parts.length - 1][0] + '.';
        const candidate = `${first} ${lastInitial}`;
        if (candidate.length <= maxChars) return candidate;
        return first.slice(0, maxChars);
    }
    return label.slice(0, maxChars);
}

/** Minimum arc angular width (radians) to show a label. */
const MIN_LABEL_ARC = 0.22; // ~12.6°

// ─── Component ────────────────────────────────────────────────────────────────

const FanChartPanel = forwardRef<FanChartPanelHandle, FanChartPanelProps>(function FanChartPanel({
    nodes,
    links,
    rootPersonId,
    maxGen,
    onMaxGenChange,
    onRootChange,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });

    useImperativeHandle(ref, () => ({
        resetView: () => { setScale(1); setPan({ x: 0, y: 0 }); },
    }));
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

    // Observe container size
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const obs = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            setDims({ width: Math.max(200, width), height: Math.max(200, height) });
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    // Wheel zoom
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            const newScale = Math.max(0.2, Math.min(5, scale * factor));
            // Zoom toward cursor position
            const rect = el.getBoundingClientRect();
            const cx = e.clientX - rect.left - dims.width / 2;
            const cy = e.clientY - rect.top - dims.height / 2;
            const ds = newScale - scale;
            setPan(p => ({ x: p.x - cx * ds / scale, y: p.y - cy * ds / scale }));
            setScale(newScale);
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [scale, dims]);

    const DRAG_THRESHOLD = 5;

    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            // Don't capture — let clicks on buttons and SVG arcs work naturally
            dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
        },
        [pan],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (!isDragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                setIsDragging(true);
            }
            if (isDragging || Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
            }
        },
        [isDragging],
    );

    const handlePointerUp = useCallback(() => {
        setIsDragging(false);
        dragRef.current = null;
    }, []);

    const isDark =
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

    // Build ancestor tree and fan arcs
    const { rootNode, arcs } = useMemo(() => {
        if (!rootPersonId) return { rootNode: null, arcs: [] };

        const nodeRefs = nodes.map((n) => ({ id: n.id, label: n.label, sex: n.sex }));
        const linkRefs = links.map((l) => ({
            source: typeof l.source === 'object' ? (l.source as { id: string }).id : (l.source as string),
            target: typeof l.target === 'object' ? (l.target as { id: string }).id : (l.target as string),
            type: l.type,
        }));

        const slots = buildAncestorTree(nodeRefs, linkRefs, rootPersonId, maxGen);
        const root = slots.find((s) => s.generation === 0) ?? null;
        const containerSize = Math.min(dims.width, dims.height);
        const computed = computeFanArcLayout(slots, containerSize, BASE_R);

        return { rootNode: root, arcs: computed };
    }, [rootPersonId, nodes, links, maxGen, dims.width, dims.height]);

    const handleArcClick = useCallback(
        (slot: AncestorSlot) => {
            if (slot.id) onRootChange(slot.id);
        },
        [onRootChange],
    );

    // Fan center: center of viewport
    const cx = dims.width / 2;
    const cy = dims.height / 2;

    if (!rootPersonId) {
        return (
            <div
                ref={containerRef}
                className="relative w-full h-full flex items-center justify-center"
            >
                <div className="text-center space-y-2 text-muted-foreground">
                    <Network className="h-10 w-10 mx-auto opacity-25" />
                    <p className="text-sm font-medium">Select a focal person</p>
                    <p className="text-xs opacity-60">Use the Focal picker above to choose a root ancestor</p>
                </div>
            </div>
        );
    }

    const transform = `translate(${cx + pan.x}, ${cy + pan.y}) scale(${scale})`;

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full overflow-hidden"
            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <svg
                width={dims.width}
                height={dims.height}
                data-testid="fan-chart-svg"
                className="select-none"
            >
                <g transform={transform}>
                    {/* Arcs — rendered back-to-front (largest generation first for overlap) */}
                    {[...arcs].reverse().map((arc) => {
                        const isEmpty = !arc.slot.id;
                        const angleDelta = arc.endAngle - arc.startAngle;
                        const midA = arcMidAngle(arc);
                        const labelR = (arc.innerR + arc.outerR) / 2;
                        // Labels positioned relative to center (0,0) since transform handles offset
                        const lx = labelR * Math.cos(midA);
                        const ly = labelR * Math.sin(midA);
                        const showLabel = !isEmpty && angleDelta >= MIN_LABEL_ARC;

                        // Label rotation: keep text readable
                        let labelRotDeg = (midA * 180) / Math.PI + 90;
                        // Flip text that would be upside-down
                        if (midA > Math.PI / 2 && midA < (3 * Math.PI) / 2) {
                            labelRotDeg += 180;
                        }

                        return (
                            <g key={`${arc.slot.generation}-${arc.slot.slotIndex}`}>
                                <path
                                    d={arcPathStr(arc, 0, 0)}
                                    fill={isEmpty ? 'var(--muted)' : lineageColor(arc.slot, isDark)}
                                    stroke="var(--background)"
                                    strokeWidth={1.5}
                                    opacity={isEmpty ? 0.18 : 1}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleArcClick(arc.slot);
                                    }}
                                    className={isEmpty ? 'cursor-default' : 'cursor-pointer'}
                                    style={!isEmpty ? { transition: 'opacity 0.15s' } : undefined}
                                    onMouseEnter={
                                        !isEmpty
                                            ? (e) => {
                                                  (e.currentTarget as SVGPathElement).style.opacity = '0.75';
                                              }
                                            : undefined
                                    }
                                    onMouseLeave={
                                        !isEmpty
                                            ? (e) => {
                                                  (e.currentTarget as SVGPathElement).style.opacity = '1';
                                              }
                                            : undefined
                                    }
                                />
                                {showLabel && (
                                    <text
                                        x={lx}
                                        y={ly}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fontSize={Math.max(8, Math.min(11, angleDelta * 28))}
                                        fill="white"
                                        transform={`rotate(${labelRotDeg.toFixed(1)}, ${lx.toFixed(1)}, ${ly.toFixed(1)})`}
                                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                                    >
                                        {shortName(arc.slot.label, Math.max(6, Math.floor(angleDelta * 18)))}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Root circle at center (0,0) */}
                    {rootNode && (
                        <g>
                            <circle
                                cx={0}
                                cy={0}
                                r={BASE_R}
                                fill={sexColor(rootNode.sex)}
                                opacity={0.92}
                            />
                            <text
                                x={0}
                                y={-6}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={11}
                                fontWeight={600}
                                fill="white"
                                style={{ pointerEvents: 'none', userSelect: 'none' }}
                            >
                                {shortName(rootNode.label, 16)}
                            </text>
                        </g>
                    )}
                </g>
            </svg>

            {/* Controls overlay — sits above the drag surface */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
                {/* Generation depth selector */}
                <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-2 py-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mr-1">
                        Gen
                    </span>
                    {([3, 4, 5, 6] as const).map((g) => (
                        <button
                            key={g}
                            onClick={(e) => {
                                e.stopPropagation();
                                onMaxGenChange(g);
                            }}
                            className={`h-6 w-6 rounded text-[11px] font-mono transition-colors ${
                                maxGen === g
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                            }`}
                            title={`Show ${g} generations`}
                        >
                            {g}
                        </button>
                    ))}
                </div>

            </div>

            {/* Legend */}
            <div className="absolute bottom-3 right-3 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-3 py-2 text-xs space-y-1 pointer-events-none">
                <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
                    Lineage
                </p>
                <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-4 rounded-sm" style={{ background: 'hsl(220,65%,52%)' }} />
                    <span className="text-muted-foreground">Paternal</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-4 rounded-sm" style={{ background: 'hsl(340,65%,52%)' }} />
                    <span className="text-muted-foreground">Maternal</span>
                </div>
            </div>

            {/* Hint */}
            <p className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50 pointer-events-none">
                Scroll to zoom · drag to pan · click arc to re-root
            </p>
        </div>
    );
});

export default FanChartPanel;
