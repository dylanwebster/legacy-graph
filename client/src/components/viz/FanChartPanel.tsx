import { useRef, useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import {
    buildAncestorTree,
    computeFanArcLayout,
    type AncestorSlot,
    type FanArc,
} from '@/utils/genealogyLayout';
import { sexColor } from '@/utils/sexColors';
import { CircleDot } from 'lucide-react';
import { PersonPreviewCard, lifeLine, resolveSpouseLabel } from './PersonPreviewCard';
import { abbreviateName } from '@/utils/nameUtils';

// ─── Handle ───────────────────────────────────────────────────────────────────

export interface FanChartPanelHandle {
    resetView: () => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ViewState {
    scale: number;
    pan: { x: number; y: number };
}

interface FanChartPanelProps {
    nodes: GraphNodeData[];
    links: GraphLinkData[];
    rootPersonId: string | null;
    maxGen: number;
    onMaxGenChange: (gen: number) => void;
    onRootChange: (id: string) => void;
    initialView?: ViewState | null;
    onViewChange?: (view: ViewState) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_R = 56;
/**
 * Vertical offset applied to the fan's SVG transform so the 270° arc's visual
 * mass recenters in the viewport. Expressed as a fraction of container height.
 * Kept in sync with related interaction math that depends on the same rendered
 * placement, such as popover positioning and hover re-evaluation.
 */
const FAN_OFFSET_Y_FRAC = 0.07;
/**
 * Gradient from paternal blue (#60a5fa ≈ hsl 217) to maternal pink (#f472b6 ≈ hsl 330)
 * via the LONG path around the colour wheel: blue → green → yellow → orange → red → pink.
 * Hue travels 217 → 0 → 330, a span of 247°.
 */
const PATERNAL_HUE = 217;
const MATERNAL_HUE = 330;
// Long-path span going clockwise (decreasing hue, wrapping through 0)
const LONG_PATH_SPAN = PATERNAL_HUE + (360 - MATERNAL_HUE); // 247°

function lineageColor(slot: AncestorSlot, isDark: boolean): string {
    if (slot.generation === 0) return sexColor(slot.sex);
    const slotsInGen = Math.pow(2, slot.generation);
    const maxSlot = slotsInGen - 1;
    const t = maxSlot === 0 ? 0 : slot.slotIndex / maxSlot;
    // Traverse 217 → 0 → 330 (long path: blue→green→yellow→orange→red→pink)
    const hue = ((PATERNAL_HUE - t * LONG_PATH_SPAN) % 360 + 360) % 360;
    const saturation = isDark ? 55 : 52;
    const lightness = isDark ? 62 : 58;
    return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
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

/**
 * Word-wrap a person label to fit within a fixed column width.
 * Abbreviates first, then greedily packs words into lines.
 * Preserves the final allowed line by truncating the remaining text with "…".
 */
function wrapName(label: string, maxCharsPerLine: number, maxLines: number): string[] {
    if (maxCharsPerLine <= 0 || maxLines <= 0) return [];

    const abbreviated = abbreviateName(label);
    if (abbreviated.length <= maxCharsPerLine) return [abbreviated];

    const words = abbreviated.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    const truncateLine = (text: string): string => {
        if (text.length <= maxCharsPerLine) return text;
        if (maxCharsPerLine === 1) return '…';
        return `${text.slice(0, maxCharsPerLine - 1)}…`;
    };

    for (let i = 0; i < words.length; i++) {
        if (lines.length === maxLines - 1) {
            const remaining = [current, ...words.slice(i)].filter(Boolean).join(' ');
            if (remaining) lines.push(truncateLine(remaining));
            return lines.filter(Boolean);
        }

        const word = words[i];
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= maxCharsPerLine) {
            current = candidate;
        } else {
            if (current) {
                lines.push(current);
                current = '';
                i -= 1;
            } else {
                lines.push(truncateLine(word));
            }
        }
    }

    if (current && lines.length < maxLines) lines.push(truncateLine(current));
    return lines.filter(Boolean);
}

/** Format birth/death years for display inside an arc. */
function buildYearsStr(node?: { birthYear?: number | null; deathYear?: number | null } | null): string {
    const b = node?.birthYear ?? null;
    const d = node?.deathYear ?? null;
    if (b && d) return `${b}–${d}`;
    if (b) return `b. ${b}`;
    if (d) return `d. ${d}`;
    return '';
}

/** Minimum arc angular width (radians) to show a label for inner curved-text rings (gen 1–3). */
const MIN_LABEL_ARC_INNER = 0.15; // ~8.6°
/** Minimum arc angular width (radians) to show a label for outer radial-text rings (gen 4+).
 *  Much lower because available space is along the radial axis, not the tangential arc. */
const MIN_LABEL_ARC_OUTER = 0.05; // ~2.9°

const MOBILE_BREAKPOINT = 640;

// ─── Component ────────────────────────────────────────────────────────────────

const FanChartPanel = forwardRef<FanChartPanelHandle, FanChartPanelProps>(function FanChartPanel({
    nodes,
    links,
    rootPersonId,
    maxGen,
    onMaxGenChange,
    onRootChange,
    initialView,
    onViewChange,
}, ref) {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    // Last known cursor position inside the SVG — used to re-evaluate hover when the
    // geometry changes (pan, zoom, resize) without requiring cursor movement.
    const lastCursorRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const [dims, setDims] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(initialView?.scale ?? 1);
    const [pan, setPan] = useState(initialView?.pan ?? { x: 0, y: 0 });
    const scaleRef = useRef(scale);
    const panRef = useRef(pan);
    const dimsRef = useRef(dims);
    // Keep refs in sync when React state changes (e.g. resetView, programmatic updates)
    useEffect(() => { scaleRef.current = scale; panRef.current = pan; }, [scale, pan]);
    useEffect(() => { dimsRef.current = dims; }, [dims]);
    const transformGroupRef = useRef<SVGGElement>(null);
    const viewSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Apply transform directly to the DOM — bypasses React render for smooth zoom/pan */
    const applyTransform = useCallback(() => {
        const g = transformGroupRef.current;
        if (!g) return;
        const d = dimsRef.current;
        const cx = d.width / 2;
        const cy = d.height / 2;
        const offsetY = d.height * FAN_OFFSET_Y_FRAC;
        const p = panRef.current;
        const s = scaleRef.current;
        g.setAttribute('transform', `translate(${cx + p.x}, ${cy + p.y + offsetY}) scale(${s})`);
    }, []);

    /** Flush ref values to React state + persist view (debounced) */
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduleSync = useCallback(() => {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(() => {
            setScale(scaleRef.current);
            setPan({ ...panRef.current });
        }, 150);
    }, []);

    useImperativeHandle(ref, () => ({
        resetView: () => {
            scaleRef.current = 1;
            panRef.current = { x: 0, y: 0 };
            applyTransform();
            setScale(1);
            setPan({ x: 0, y: 0 });
        },
    }));

    // Stable ref for onViewChange
    const onViewChangeRef = useRef(onViewChange);
    useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);

    // Debounced view state persistence — only fires when React state settles
    useEffect(() => {
        if (!onViewChangeRef.current) return;
        if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
        viewSaveTimerRef.current = setTimeout(() => {
            onViewChangeRef.current?.({ scale, pan });
        }, 300);
        return () => {
            if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
        };
    }, [scale, pan]);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false); // ref mirror — lets move handler be stable (no stale closure)
    const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

    // Selected arc for preview popover
    const [selectedArc, setSelectedArc] = useState<FanArc | null>(null);
    // Hovered arc — tracked via React state (not inline DOM mutation) for consistent rendering
    const [hoveredArcId, setHoveredArcId] = useState<string | null>(null);

    const isMobile = dims.width < MOBILE_BREAKPOINT;

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

    // Wheel zoom — mutates refs + DOM directly for smooth animation, debounces React sync
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            lastCursorRef.current = { clientX: e.clientX, clientY: e.clientY };
            const curScale = scaleRef.current;
            const curDims = dimsRef.current;
            const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            const newScale = Math.max(0.2, Math.min(5, curScale * factor));
            const rect = el.getBoundingClientRect();
            const cx = e.clientX - rect.left - curDims.width / 2;
            const cy = e.clientY - rect.top - curDims.height / 2;
            const ds = newScale - curScale;
            panRef.current = {
                x: panRef.current.x - cx * ds / curScale,
                y: panRef.current.y - cy * ds / curScale,
            };
            scaleRef.current = newScale;
            applyTransform();
            scheduleSync();
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [applyTransform, scheduleSync]);

    const DRAG_THRESHOLD = 5;

    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            isDraggingRef.current = false;
            dragRef.current = { startX: e.clientX, startY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
        },
        [],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                if (!isDraggingRef.current) {
                    isDraggingRef.current = true;
                    setIsDragging(true);
                    containerRef.current?.setPointerCapture(e.pointerId);
                }
                panRef.current = { x: dragRef.current.panX + dx, y: dragRef.current.panY + dy };
                applyTransform();
                scheduleSync();
            }
        },
        [applyTransform, scheduleSync],
    );

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        isDraggingRef.current = false;
        setIsDragging(false);
        dragRef.current = null;
        // Capture final cursor position so the geometry-change effect can re-evaluate
        // hover correctly after the drag ends (without requiring cursor movement).
        lastCursorRef.current = { clientX: e.clientX, clientY: e.clientY };
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

    // Auto scale-to-fit on initial load (only when no saved view state exists)
    const hasAutoFitRef = useRef(false);
    useEffect(() => {
        if (hasAutoFitRef.current || initialView || arcs.length === 0) return;
        const maxR = Math.max(...arcs.map((a) => a.outerR));
        const containerSize = Math.min(dims.width, dims.height);
        const available = containerSize * 0.45;
        if (maxR > available) {
            setScale(available / maxR);
        }
        hasAutoFitRef.current = true;
    }, [arcs, dims.width, dims.height, initialView]);

    const graphNodeMap = useMemo(
        () => new Map(nodes.map(n => [n.id, n])),
        [nodes],
    );

    const handleArcClick = useCallback(
        (arc: FanArc) => {
            if (!arc.slot.id) return;
            setSelectedArc(prev => prev?.slot.id === arc.slot.id ? null : arc);
        },
        [],
    );

    const handleMakeFocal = useCallback((id: string) => {
        setSelectedArc(null);
        onRootChange(id);
    }, [onRootChange]);

    const handleViewProfile = useCallback((id: string) => {
        void navigate({ to: '/people/$id', params: { id } });
    }, [navigate]);

    const handleBackgroundClick = useCallback(() => {
        if (selectedArc) setSelectedArc(null);
    }, [selectedArc]);

    // Fan center: center of viewport
    const cx = dims.width / 2;
    const cy = dims.height / 2;

    // Arc lookup by unique key (gen:slotIndex) — used to map native DOM events
    // back to FanArc objects. Uses slot coordinates rather than person ID to
    // handle pedigree collapse (same ancestor in multiple slots).
    const arcByKey = useMemo(
        () => new Map(arcs.filter(a => a.slot.id).map(a => [`${a.slot.generation}:${a.slot.slotIndex}`, a])),
        [arcs],
    );

    // ── Native SVG event-based hover & click ─────────────────────────────────
    // Filled arc <path> elements receive pointer events (empty arcs do not).
    // The browser's own SVG hit-testing on the rendered paths is authoritative —
    // no manual coordinate inversion, no floating-point edge cases.

    /** Read the arc ID from the nearest arc path at an event target. */
    const arcIdFromTarget = useCallback(
        (target: EventTarget | null): string | null =>
            (target as Element)?.closest?.('[data-arc-id]')?.getAttribute('data-arc-id') ?? null,
        [],
    );

    const handleSvgMouseMove = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            if (isDraggingRef.current) return;
            lastCursorRef.current = { clientX: e.clientX, clientY: e.clientY };
            setHoveredArcId(arcIdFromTarget(e.target));
        },
        [arcIdFromTarget],
    );

    const handleSvgClick = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            if (isDraggingRef.current) return;
            const arcKey = arcIdFromTarget(e.target);
            if (arcKey) {
                e.stopPropagation(); // prevent handleBackgroundClick from closing selectedArc
                const arc = arcByKey.get(arcKey);
                if (arc) handleArcClick(arc);
            }
            // No arc hit — let the event bubble to the container's handleBackgroundClick.
        },
        [arcIdFromTarget, arcByKey, handleArcClick],
    );

    // Re-evaluate hover whenever the transform geometry changes (pan, zoom, resize)
    // or a drag ends — the cursor hasn't moved but the chart beneath it has.
    // Uses document.elementFromPoint so the browser's own hit-testing is authoritative.
    useEffect(() => {
        if (isDragging) return;
        const pos = lastCursorRef.current;
        if (!pos) return;
        const el = document.elementFromPoint(pos.clientX, pos.clientY);
        const arcId = (el as Element | null)?.closest?.('[data-arc-id]')?.getAttribute('data-arc-id') ?? null;
        setHoveredArcId(arcId);
    }, [pan, scale, isDragging, dims]);

    // Keep the DOM transform in sync after React re-renders (e.g. data change, resize)
    useEffect(() => { applyTransform(); }, [dims, applyTransform]);

    if (!rootPersonId) {
        return (
            <div
                ref={containerRef}
                className="relative w-full h-full flex items-center justify-center"
            >
                <div className="text-center space-y-2 text-muted-foreground">
                    <CircleDot className="h-10 w-10 mx-auto opacity-25" />
                    <p className="text-sm font-medium">Select a focal person above to display the chart</p>
                </div>
            </div>
        );
    }

    // Shift arc origin slightly down: 270° fan's mass sits above center, this recenters it visually
    const FAN_OFFSET_Y = dims.height * FAN_OFFSET_Y_FRAC;
    const transform = `translate(${cx + pan.x}, ${cy + pan.y + FAN_OFFSET_Y}) scale(${scale})`;

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full overflow-hidden"
            style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClick={handleBackgroundClick}
        >
            <svg
                width={dims.width}
                height={dims.height}
                data-testid="fan-chart-svg"
                className="select-none"
                onMouseMove={handleSvgMouseMove}
                onMouseLeave={() => {
                    if (!isDraggingRef.current) {
                        lastCursorRef.current = null;
                        setHoveredArcId(null);
                    }
                }}
                onClick={handleSvgClick}
            >
                <g ref={transformGroupRef} transform={transform}>
                    {/* Curved text paths for gen 1–3 arcs.
                        Path travels START→END clockwise (sweep=1): ascenders point outward so text
                        reads correctly from outside the chart.
                        One path per line (name lines + optional years), each at the radius
                        that centers the whole block within the arc band. */}
                    <defs>
                        {arcs
                            .filter((arc) => arc.slot.generation >= 1 && arc.slot.generation <= 3 && arc.slot.id)
                            .flatMap((arc) => {
                                const arcH = arc.outerR - arc.innerR;
                                const angleDelta = arc.endAngle - arc.startAngle;
                                const midR = (arc.innerR + arc.outerR) / 2;
                                const nameFontSize = Math.min(14, Math.max(10, arcH * 0.19));
                                const yearsFontSize = Math.max(8, nameFontSize - 2);
                                const lineHeight = nameFontSize * 1.3;
                                const arcLength = midR * angleDelta;
                                const maxCharsPerLine = Math.max(5, Math.floor(arcLength / (nameFontSize * 0.54)));
                                const gNode = arc.slot.id ? graphNodeMap.get(arc.slot.id) : undefined;
                                const hasYears = !!buildYearsStr(gNode) && angleDelta >= 0.22 && arcH >= 22;
                                const maxNameLines = Math.min(3, Math.max(1,
                                    Math.floor((arcH - (hasYears ? yearsFontSize * 1.4 : 0)) / lineHeight)
                                ));
                                const nameLines = wrapName(arc.slot.label, maxCharsPerLine, maxNameLines);
                                const nSlots = nameLines.length + (hasYears ? 1 : 0);
                                const g = arc.slot.generation;
                                const i = arc.slot.slotIndex;
                                const largeArc = angleDelta > Math.PI ? 1 : 0;
                                const makePath = (r: number) => {
                                    const rr = Math.max(1, r);
                                    const sx = (rr * Math.cos(arc.startAngle)).toFixed(2);
                                    const sy = (rr * Math.sin(arc.startAngle)).toFixed(2);
                                    const ex = (rr * Math.cos(arc.endAngle)).toFixed(2);
                                    const ey = (rr * Math.sin(arc.endAngle)).toFixed(2);
                                    return `M ${sx} ${sy} A ${rr.toFixed(2)} ${rr.toFixed(2)} 0 ${largeArc} 1 ${ex} ${ey}`;
                                };
                                // Slot 0 = outermost, slot nSlots-1 = innermost, block centered at midR
                                const slotR = (slot: number) => midR + ((nSlots - 1) / 2 - slot) * lineHeight;
                                return [
                                    ...nameLines.map((_, li) => (
                                        <path key={`fan-tp-${g}-${i}-${li}`} id={`fan-tp-${g}-${i}-${li}`} d={makePath(slotR(li))} />
                                    )),
                                    ...(hasYears ? [
                                        <path key={`fan-tp-${g}-${i}-y`} id={`fan-tp-${g}-${i}-y`} d={makePath(slotR(nameLines.length))} />,
                                    ] : []),
                                ];
                            })}
                    </defs>

                    {/* Arcs — rendered back-to-front (largest generation first for overlap) */}
                    {[...arcs].reverse().map((arc) => {
                        const isEmpty = !arc.slot.id;
                        const angleDelta = arc.endAngle - arc.startAngle;
                        const midA = arcMidAngle(arc);
                        const arcH = arc.outerR - arc.innerR;
                        const labelR = (arc.innerR + arc.outerR) / 2;
                        const arcTangentialWidth = labelR * angleDelta; // px along arc midline

                        const arcKey = `${arc.slot.generation}:${arc.slot.slotIndex}`;
                        const isSelected = !!arc.slot.id && selectedArc?.slot.generation === arc.slot.generation && selectedArc?.slot.slotIndex === arc.slot.slotIndex;
                        const isHovered = !!arc.slot.id && arcKey === hoveredArcId;

                        const gNode = arc.slot.id ? graphNodeMap.get(arc.slot.id) : undefined;
                        const yearsStr = buildYearsStr(gNode);

                        // Gen 1–3: curved text following the arc; gen 4+: straight radial text.
                        const isInnerRing = arc.slot.generation <= 3;
                        const minLabelArc = isInnerRing ? MIN_LABEL_ARC_INNER : MIN_LABEL_ARC_OUTER;
                        const showLabel = !isEmpty && angleDelta >= minLabelArc;

                        return (
                            <g key={`${arc.slot.generation}-${arc.slot.slotIndex}`}>
                                <path
                                    className="fan-arc"
                                    d={arcPathStr(arc, 0, 0)}
                                    data-arc-id={isEmpty ? undefined : arcKey}
                                    fill={isEmpty ? 'var(--muted)' : lineageColor(arc.slot, isDark)}
                                    stroke={isSelected ? 'var(--primary)' : isHovered ? 'rgba(255,255,255,0.55)' : 'var(--background)'}
                                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                                    opacity={isEmpty ? 0.18 : isSelected ? 0.95 : isHovered ? 0.72 : 0.88}
                                    pointerEvents={isEmpty ? 'none' : 'fill'}
                                    style={{ cursor: isEmpty ? undefined : 'pointer', transition: 'opacity 0.12s, stroke 0.12s' }}
                                />

                                {showLabel && isInnerRing && (() => {
                                    // ── Gen 1–3: curved text — one <textPath> per line ─────────────
                                    // Mirrors the defs computation exactly so path IDs match.
                                    const nameFontSize = Math.min(14, Math.max(10, arcH * 0.19));
                                    const yearsFontSize = Math.max(8, nameFontSize - 2);
                                    const lineHeight = nameFontSize * 1.3;
                                    const arcLength = labelR * angleDelta;
                                    const maxCharsPerLine = Math.max(5, Math.floor(arcLength / (nameFontSize * 0.54)));
                                    const showYears = !!yearsStr && angleDelta >= 0.22 && arcH >= 22;
                                    const maxNameLines = Math.min(3, Math.max(1,
                                        Math.floor((arcH - (showYears ? yearsFontSize * 1.4 : 0)) / lineHeight)
                                    ));
                                    const nameLines = wrapName(arc.slot.label, maxCharsPerLine, maxNameLines);
                                    const g = arc.slot.generation;
                                    const i = arc.slot.slotIndex;
                                    return (
                                        <>
                                            {nameLines.map((line, li) => (
                                                <text
                                                    key={li}
                                                    dominantBaseline="middle"
                                                    fill="black"
                                                    fontSize={nameFontSize}
                                                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                                                >
                                                    <textPath href={`#fan-tp-${g}-${i}-${li}`} startOffset="50%" textAnchor="middle">
                                                        {line}
                                                    </textPath>
                                                </text>
                                            ))}
                                            {showYears && (
                                                <text
                                                    dominantBaseline="middle"
                                                    fill="black"
                                                    fontSize={yearsFontSize}
                                                    opacity={0.8}
                                                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                                                >
                                                    <textPath href={`#fan-tp-${g}-${i}-y`} startOffset="50%" textAnchor="middle">
                                                        {yearsStr}
                                                    </textPath>
                                                </text>
                                            )}
                                        </>
                                    );
                                })()}

                                {showLabel && !isInnerRing && (() => {
                                    // ── Gen 4+: straight radial text along the longer axis ──────────
                                    // Text is rotated to the radial direction; multiple lines stack
                                    // tangentially (perpendicular). Font size is uniform across all
                                    // outer generations — the arcs are thick enough to support it.
                                    const lx = labelR * Math.cos(midA);
                                    const ly = labelR * Math.sin(midA);
                                    const normMid = ((midA % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                                    let labelRotDeg = normMid * 180 / Math.PI;
                                    if (labelRotDeg > 90 && labelRotDeg < 270) labelRotDeg -= 180;

                                    // Uniform font size for all outer rings (gen 4–6).
                                    // Minimum 10px — gen 6 arcs are thick enough to handle it.
                                    const nameFontSize = Math.max(10, Math.min(12, arcTangentialWidth / 8));
                                    const yearsFontSize = Math.max(8, nameFontSize - 2);
                                    const lineHeight = nameFontSize * 1.3;

                                    // Chars per line: radial height (the long axis) / charWidth
                                    const maxCharsPerLine = Math.max(4, Math.floor(arcH / (nameFontSize * 0.56)));
                                    // Lines stack tangentially; cap at 2 to avoid overflow
                                    const maxNameLines = Math.min(2, Math.max(1, Math.floor(arcTangentialWidth / lineHeight)));
                                    const showYears = !!yearsStr && arcTangentialWidth >= 24;
                                    const nameLines = wrapName(arc.slot.label, maxCharsPerLine, maxNameLines);
                                    const nSlots = nameLines.length + (showYears ? 1 : 0);

                                    // Center the block tangentially around (lx, ly)
                                    // dy values are in the text's local coordinate system (tangential direction)
                                    const startDy = -((nSlots - 1) / 2) * lineHeight;

                                    return (
                                        <text
                                            x={lx}
                                            y={ly}
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            fill="black"
                                            transform={`rotate(${labelRotDeg.toFixed(1)}, ${lx.toFixed(1)}, ${ly.toFixed(1)})`}
                                            style={{ pointerEvents: 'none', userSelect: 'none' }}
                                        >
                                            {nameLines.map((line, li) => (
                                                <tspan
                                                    key={li}
                                                    x={lx}
                                                    fontSize={nameFontSize}
                                                    dy={li === 0 ? startDy.toFixed(1) : lineHeight.toFixed(1)}
                                                >
                                                    {line}
                                                </tspan>
                                            ))}
                                            {showYears && (
                                                <tspan
                                                    x={lx}
                                                    fontSize={yearsFontSize}
                                                    dy={(nameLines.length === 0 ? startDy : lineHeight * 0.95).toFixed(1)}
                                                    opacity={0.8}
                                                >
                                                    {yearsStr}
                                                </tspan>
                                            )}
                                        </text>
                                    );
                                })()}
                            </g>
                        );
                    })}

                    {/* Root circle at center (0,0) */}
                    {rootNode && (() => {
                        const rootGNode = rootNode.id ? graphNodeMap.get(rootNode.id) : undefined;
                        const rootYears = buildYearsStr(rootGNode);
                        return (
                            <g>
                                <circle
                                    cx={0}
                                    cy={0}
                                    r={BASE_R}
                                    fill="#94a3b8"
                                    opacity={0.92}
                                />
                                <text
                                    x={0}
                                    y={0}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fill="white"
                                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                                >
                                    <tspan x={0} dy={rootYears ? '-0.5em' : '0'} fontSize={11} fontWeight={600}>
                                        {wrapName(rootNode.label, 16, 1)[0] ?? ''}
                                    </tspan>
                                    {rootYears && (
                                        <tspan x={0} dy="1.15em" fontSize={9} opacity={0.85}>
                                            {rootYears}
                                        </tspan>
                                    )}
                                </text>
                            </g>
                        );
                    })()}
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
                    <span className="inline-block h-2 w-4 rounded-sm" style={{ background: `hsl(${PATERNAL_HUE}, 52%, 58%)`, opacity: 0.88 }} />
                    <span className="text-muted-foreground">Paternal</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-4 rounded-sm" style={{ background: `hsl(${MATERNAL_HUE}, 52%, 58%)`, opacity: 0.88 }} />
                    <span className="text-muted-foreground">Maternal</span>
                </div>
            </div>

            {/* Hint */}
            <p className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50 pointer-events-none">
                Scroll to zoom · drag to pan · click arc for options
            </p>

            {/* Arc preview popover/sheet */}
            {selectedArc && selectedArc.slot.id && (() => {
                const { slot } = selectedArc;
                const midA = arcMidAngle(selectedArc);
                const offsetR = selectedArc.outerR + 16;
                const screenX = cx + pan.x + offsetR * Math.cos(midA) * scale;
                const screenY = cy + pan.y + FAN_OFFSET_Y + offsetR * Math.sin(midA) * scale;
                const gNode = graphNodeMap.get(slot.id!);
                return (
                    <PersonPreviewCard
                        personId={slot.id!}
                        label={slot.label}
                        sex={slot.sex}
                        primaryAsset={gNode?.primaryAsset ?? null}
                        birthLine={lifeLine('b. ', gNode?.birthYear ?? null, gNode?.birthPlace ?? null)}
                        deathLine={lifeLine('d. ', gNode?.deathYear ?? null, gNode?.deathPlace ?? null)}
                        spouseLabel={resolveSpouseLabel(slot.id!, links, graphNodeMap)}
                        screenX={screenX}
                        screenY={screenY}
                        containerWidth={dims.width}
                        containerHeight={dims.height}
                        isMobile={isMobile}
                        onClose={() => setSelectedArc(null)}
                        onMakeFocal={handleMakeFocal}
                        onViewProfile={handleViewProfile}
                    />
                );
            })()}
        </div>
    );
});

export default FanChartPanel;
