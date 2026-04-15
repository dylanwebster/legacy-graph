import { useRef, useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Network } from 'lucide-react';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import {
    buildFamilyTree,
    computeAdaptiveTreeLayout,
} from '@/utils/genealogyLayout';
import { sexColor as sexStroke } from '@/utils/sexColors';
import { abbreviateName } from '@/utils/nameUtils';
import { PersonPreviewCard, lifeLine, resolveSpouseLabel } from './PersonPreviewCard';
import { useUIStore } from '@/store/uiStore';

// ─── Handle ───────────────────────────────────────────────────────────────────

export interface PedigreePanelHandle {
    resetView: () => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ViewState {
    scale: number;
    pan: { x: number; y: number };
}

interface ExpandedState {
    up: string[];
    down: string[];
    siblings: string[];
}

interface PedigreePanelProps {
    nodes: GraphNodeData[];
    links: GraphLinkData[];
    rootPersonId: string | null;
    orientation: 'horizontal' | 'vertical';
    onOrientationChange: (o: 'horizontal' | 'vertical') => void;
    onRootChange: (id: string) => void;
    initialView?: ViewState | null;
    onViewChange?: (view: ViewState) => void;
    initialExpanded?: ExpandedState | null;
    onExpandChange?: (expanded: ExpandedState) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ANCESTOR_DEPTH = 3;
const DEFAULT_DESCENDANT_DEPTH = 3;
const MOBILE_BREAKPOINT = 640;

/**
 * Split a full name into [line1, line2|null].
 * Short names stay on one line. Long names split given-name(s) / surname.
 * Each line is capped at nameMax chars.
 */
function splitNameLines(label: string, nameMax = 24): [string, string | null] {
    const cap = (s: string) => s.length > nameMax ? s.slice(0, nameMax - 1) + '…' : s;
    if (label.length <= nameMax) return [label, null];
    const parts = label.split(' ');
    if (parts.length === 1) return [cap(label), null];
    const surname = parts[parts.length - 1];
    const given = parts.slice(0, -1).join(' ');
    return [cap(given), cap(surname)];
}

function getInitials(label: string): string {
    const parts = abbreviateName(label).trim().split(/\s+/);
    if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

const PedigreePanel = forwardRef<PedigreePanelHandle, PedigreePanelProps>(function PedigreePanel({
    nodes,
    links,
    rootPersonId,
    orientation,
    onOrientationChange,
    onRootChange,
    initialView,
    onViewChange,
    initialExpanded,
    onExpandChange,
}, ref) {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(initialView?.scale ?? 1);
    const [pan, setPan] = useState(initialView?.pan ?? { x: 0, y: 0 });
    const scaleRef = useRef(scale);
    const panRef = useRef(pan);
    const dimsRef = useRef(dims);
    useEffect(() => { scaleRef.current = scale; panRef.current = pan; }, [scale, pan]);
    useEffect(() => { dimsRef.current = dims; }, [dims]);
    const transformGroupRef = useRef<SVGGElement>(null);
    const viewSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expandSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Apply transform directly to the DOM — bypasses React render for smooth zoom/pan */
    const applyTransform = useCallback(() => {
        const g = transformGroupRef.current;
        if (!g) return;
        const d = dimsRef.current;
        const p = panRef.current;
        const s = scaleRef.current;
        g.setAttribute('transform', `translate(${d.width / 2 + p.x}, ${d.height / 2 + p.y}) scale(${s})`);
    }, []);

    /** Flush ref values to React state (debounced) */
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
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

    // Expansion state — restored from persisted state (reset on root change, see effect below)
    const [expandedUp, setExpandedUp] = useState<Set<string>>(
        () => new Set(initialExpanded?.up ?? [])
    );
    const [expandedDown, setExpandedDown] = useState<Set<string>>(
        () => new Set(initialExpanded?.down ?? [])
    );
    const [expandedSiblings, setExpandedSiblings] = useState<Set<string>>(
        () => new Set(initialExpanded?.siblings ?? [])
    );

    // Person preview
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    const isMobile = dims.width < MOBILE_BREAKPOINT;
    const ancestorDepth = isMobile ? 2 : DEFAULT_ANCESTOR_DEPTH;
    const descendantDepth = isMobile ? 2 : DEFAULT_DESCENDANT_DEPTH;

    // Card dimensions — orientation + viewport aware
    const showAvatar = !isMobile;
    const CARD_W = orientation === 'horizontal'
        ? (isMobile ? 140 : 172)
        : (isMobile ? 96 : 120);
    const CARD_H = orientation === 'horizontal'
        ? (isMobile ? 44 : 56)
        : (isMobile ? 68 : 88);
    const NAME_MAX = orientation === 'horizontal'
        ? (isMobile ? 20 : 19)
        : (isMobile ? 13 : 16);

    // Connector colors — lineage uses the same purple as the force graph highlight
    const theme = useUIStore(s => s.theme);
    const isDark = theme === 'dark';
    const lineageStroke = isDark ? 'rgba(167,139,250,0.9)' : 'rgba(139,92,246,0.85)';
    const nonLineageStroke = isDark ? 'rgba(148,163,184,0.5)' : 'rgba(71,85,105,0.5)';

    // Reset expansion + view when root actually changes (not on initial mount).
    // Comparing against a ref avoids firing on mount when rootPersonId is already set,
    // which would overwrite the persisted state restored via initialView/initialExpanded.
    const prevRootPersonId = useRef<string | null>(rootPersonId);
    useEffect(() => {
        if (prevRootPersonId.current === rootPersonId) return;
        prevRootPersonId.current = rootPersonId;
        setExpandedUp(new Set());
        setExpandedDown(new Set());
        setExpandedSiblings(new Set());
        setSelectedNodeId(null);
        setScale(1);
        setPan({ x: 0, y: 0 });
    }, [rootPersonId]);

    // Stable refs for callbacks — avoids re-triggering debounce effects
    // when the parent passes new inline arrow functions on every render
    const onViewChangeRef = useRef(onViewChange);
    useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);
    const onExpandChangeRef = useRef(onExpandChange);
    useEffect(() => { onExpandChangeRef.current = onExpandChange; }, [onExpandChange]);

    // Debounced view state persistence
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

    // Debounced expansion state persistence
    useEffect(() => {
        if (!onExpandChangeRef.current) return;
        if (expandSaveTimerRef.current) clearTimeout(expandSaveTimerRef.current);
        expandSaveTimerRef.current = setTimeout(() => {
            onExpandChangeRef.current?.({
                up: Array.from(expandedUp),
                down: Array.from(expandedDown),
                siblings: Array.from(expandedSiblings),
            });
        }, 300);
        return () => {
            if (expandSaveTimerRef.current) clearTimeout(expandSaveTimerRef.current);
        };
    }, [expandedUp, expandedDown, expandedSiblings]);

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
            const curScale = scaleRef.current;
            const curDims = dimsRef.current;
            const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            const newScale = Math.max(0.15, Math.min(4, curScale * factor));
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

    const isDraggingRef = useRef(false);

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
                }
                panRef.current = { x: dragRef.current.panX + dx, y: dragRef.current.panY + dy };
                applyTransform();
                scheduleSync();
            }
        },
        [applyTransform, scheduleSync],
    );

    const handlePointerUp = useCallback(() => {
        isDraggingRef.current = false;
        setIsDragging(false);
        dragRef.current = null;
    }, []);

    // Build family tree layout
    const { treeNodes, treeConnectors } = useMemo(() => {
        if (!rootPersonId) return { treeNodes: [], treeConnectors: [] };

        const nodeRefs = nodes.map((n) => ({ id: n.id, label: n.label, sex: n.sex }));
        const linkRefs = links.map((l) => ({
            source: typeof l.source === 'object' ? (l.source as { id: string }).id : (l.source as string),
            target: typeof l.target === 'object' ? (l.target as { id: string }).id : (l.target as string),
            type: l.type,
        }));

        const tree = buildFamilyTree(
            nodeRefs, linkRefs, rootPersonId,
            ancestorDepth, descendantDepth,
            expandedUp, expandedDown, expandedSiblings,
        );
        const layout = computeAdaptiveTreeLayout(tree, orientation, CARD_W, CARD_H);
        return { treeNodes: layout.nodes, treeConnectors: layout.connectors };
    }, [rootPersonId, nodes, links, orientation, ancestorDepth, descendantDepth,
        expandedUp, expandedDown, expandedSiblings, CARD_W, CARD_H]);

    // Node lookup for graph data (birthYear, primaryAsset)
    const graphNodeMap = useMemo(
        () => new Map(nodes.map(n => [n.id, n])),
        [nodes],
    );

    // Build sibling lookup from graph links so we can detect when siblings are
    // already shown as direct ancestors/descendants (and suppress the button).
    const graphSiblingMap = useMemo(() => {
        const parentMap = new Map<string, string[]>(); // child → parents
        const childMap = new Map<string, string[]>();  // parent → children
        for (const l of links) {
            if (l.type !== 'parent_child') continue;
            const src = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source as string;
            const tgt = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target as string;
            if (!parentMap.has(src)) parentMap.set(src, []);
            parentMap.get(src)!.push(tgt);
            if (!childMap.has(tgt)) childMap.set(tgt, []);
            childMap.get(tgt)!.push(src);
        }
        const map = new Map<string, string[]>();
        for (const [childId] of parentMap) {
            const parents = parentMap.get(childId) ?? [];
            const sibs = new Set<string>();
            for (const pid of parents) {
                for (const cid of childMap.get(pid) ?? []) {
                    if (cid !== childId) sibs.add(cid);
                }
            }
            map.set(childId, [...sibs]);
        }
        return map;
    }, [links]);

    // IDs of nodes currently visible in the tree
    const visibleNodeIds = useMemo(
        () => new Set(treeNodes.map(n => n.node.id).filter((id): id is string => id !== null)),
        [treeNodes],
    );

    // IDs of nodes shown in a *sibling role* (via another node's siblings[] array).
    // These are NOT "direct line" nodes — they were explicitly expanded via the siblings button.
    const siblingRoleIds = useMemo(() => {
        const set = new Set<string>();
        for (const n of treeNodes) {
            for (const sib of n.node.siblings) {
                if (sib.id) set.add(sib.id);
            }
        }
        return set;
    }, [treeNodes]);

    // Returns true if ALL of a node's siblings are already visible as direct-line nodes
    // (ancestor or descendant, NOT as expanded sibling nodes).
    // When true, the expand/collapse siblings button is redundant and should be hidden.
    const allSiblingsInDirectLine = useCallback((nodeId: string): boolean => {
        const sibs = graphSiblingMap.get(nodeId) ?? [];
        if (sibs.length === 0) return false;
        return sibs.every(sid => visibleNodeIds.has(sid) && !siblingRoleIds.has(sid));
    }, [graphSiblingMap, visibleNodeIds, siblingRoleIds]);

    const handleExpandAncestors = useCallback((id: string) => {
        setExpandedUp(prev => new Set([...prev, id]));
    }, []);

    const handleCollapseAncestors = useCallback((id: string) => {
        setExpandedUp(prev => { const next = new Set(prev); next.delete(id); return next; });
    }, []);

    const handleExpandDescendants = useCallback((id: string) => {
        setExpandedDown(prev => new Set([...prev, id]));
    }, []);

    const handleCollapseDescendants = useCallback((id: string) => {
        setExpandedDown(prev => { const next = new Set(prev); next.delete(id); return next; });
    }, []);

    const handleExpandSiblings = useCallback((id: string) => {
        setExpandedSiblings(prev => new Set([...prev, id]));
    }, []);

    const handleCollapseSiblings = useCallback((id: string) => {
        setExpandedSiblings(prev => { const next = new Set(prev); next.delete(id); return next; });
    }, []);

    const handleCardClick = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedNodeId(prev => prev === id ? null : id);
    }, []);

    const handleMakeFocal = useCallback((id: string) => {
        setSelectedNodeId(null);
        onRootChange(id);
    }, [onRootChange]);

    const handleViewProfile = useCallback((id: string) => {
        void navigate({ to: '/people/$id', params: { id } });
    }, [navigate]);

    // Dismiss preview on background click
    const handleBackgroundClick = useCallback(() => {
        if (selectedNodeId) setSelectedNodeId(null);
    }, [selectedNodeId]);

    // Keep the DOM transform in sync after React re-renders (e.g. data change, resize)
    useEffect(() => { applyTransform(); }, [dims, applyTransform]);

    if (!rootPersonId) {
        return (
            <div
                ref={containerRef}
                className="relative w-full h-full flex items-center justify-center"
            >
                <div className="text-center space-y-2 text-muted-foreground">
                    <Network className="h-10 w-10 mx-auto opacity-25" />
                    <p className="text-sm font-medium">Select a focal person above to display the chart</p>
                </div>
            </div>
        );
    }

    const originX = dims.width / 2;
    const originY = dims.height / 2;
    const transform = `translate(${originX + pan.x}, ${originY + pan.y}) scale(${scale})`;

    // Ancestors branch RIGHT, descendants branch LEFT
    const ExpandAncestorIcon = orientation === 'horizontal' ? ChevronRight : ChevronUp;
    const CollapseAncestorIcon = orientation === 'horizontal' ? ChevronLeft : ChevronDown;
    const ExpandDescendantIcon = orientation === 'horizontal' ? ChevronLeft : ChevronDown;
    const CollapseDescendantIcon = orientation === 'horizontal' ? ChevronRight : ChevronUp;
    // Siblings are stacked perpendicular to the main axis
    const ExpandSiblingIcon = orientation === 'horizontal' ? ChevronDown : ChevronRight;
    const CollapseSiblingIcon = orientation === 'horizontal' ? ChevronUp : ChevronLeft;

    const selectedNode = selectedNodeId
        ? treeNodes.find(n => n.node.id === selectedNodeId) ?? null
        : null;

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
                data-testid="pedigree-svg"
                className="select-none"
            >
                <defs>
                    <filter id="card-shadow" x="-15%" y="-25%" width="130%" height="150%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2.5" floodColor="black" floodOpacity="0.18" />
                    </filter>
                </defs>
                <g ref={transformGroupRef} transform={transform}>
                    {/* Connectors */}
                    {treeConnectors.map((c) => (
                        <path
                            key={c.id}
                            d={c.path}
                            fill="none"
                            stroke={c.isLineage ? lineageStroke : nonLineageStroke}
                            strokeWidth={1.5}
                        />
                    ))}

                    {/* Person cards */}
                    {treeNodes.map((n) => {
                        if (!n.node.id) return null;
                        const isRoot = n.node.generation === 0 && n.node.id === rootPersonId;
                        const isSelected = n.node.id === selectedNodeId;
                        const graphNode = graphNodeMap.get(n.node.id);
                        const birthYear = graphNode?.birthYear ?? null;
                        const deathYear = graphNode?.deathYear ?? null;
                        const lifespan = birthYear && deathYear
                            ? `${birthYear} – ${deathYear}`
                            : birthYear
                                ? `b. ${birthYear}`
                                : deathYear
                                    ? `d. ${deathYear}`
                                    : null;

                        return (
                            <g
                                key={n.node.id}
                                transform={`translate(${n.x}, ${n.y})`}
                                data-person-id={n.node.id}
                                onClick={(e) => handleCardClick(n.node.id!, e)}
                                className="cursor-pointer"
                                style={{ filter: 'url(#card-shadow)' }}
                            >
                                {/* Card background */}
                                <rect
                                    width={CARD_W}
                                    height={CARD_H}
                                    rx={6}
                                    fill="var(--card)"
                                    stroke={isSelected ? 'var(--primary)' : sexStroke(n.node.sex)}
                                    strokeWidth={isSelected ? 2.5 : isRoot ? 2.5 : 2}
                                    style={{ transition: 'stroke 0.15s, stroke-width 0.15s' }}
                                />

                                {/* Root indicator — left bar in horizontal, top bar in vertical */}
                                {isRoot && (
                                    orientation === 'horizontal' ? (
                                        <rect x={0} y={0} width={4} height={CARD_H} rx={2} fill="var(--primary)" />
                                    ) : (
                                        <rect x={0} y={0} width={CARD_W} height={4} rx={2} fill="var(--primary)" />
                                    )
                                )}

                                {/* Avatar (desktop only) */}
                                {showAvatar && (() => {
                                    const primaryAsset = graphNode?.primaryAsset ?? null;
                                    const clipId = `avatar-clip-${n.node.id}`;
                                    const acx = orientation === 'horizontal' ? 20 : CARD_W / 2;
                                    const acy = orientation === 'horizontal' ? CARD_H / 2 : 22;
                                    const r = 14;
                                    return (
                                        <>
                                            <defs>
                                                <clipPath id={clipId}>
                                                    <circle cx={acx} cy={acy} r={r} />
                                                </clipPath>
                                            </defs>
                                            {primaryAsset ? (
                                                <image
                                                    href={`/assets/${primaryAsset}`}
                                                    x={acx - r}
                                                    y={acy - r}
                                                    width={r * 2}
                                                    height={r * 2}
                                                    clipPath={`url(#${clipId})`}
                                                    preserveAspectRatio="xMidYMid slice"
                                                    style={{ pointerEvents: 'none' }}
                                                />
                                            ) : (
                                                <>
                                                    <circle cx={acx} cy={acy} r={r} fill={sexStroke(n.node.sex)} opacity={0.15} />
                                                    <text
                                                        x={acx}
                                                        y={acy + 4}
                                                        textAnchor="middle"
                                                        fontSize={10}
                                                        fontWeight={600}
                                                        fill={sexStroke(n.node.sex)}
                                                        style={{ pointerEvents: 'none' }}
                                                    >
                                                        {getInitials(n.node.label)}
                                                    </text>
                                                </>
                                            )}
                                        </>
                                    );
                                })()}

                                {/* Name (1 or 2 lines) + lifespan */}
                                {(() => {
                                    const [line1, line2] = splitNameLines(abbreviateName(n.node.label), NAME_MAX);
                                    const fw = isRoot ? 600 : 500;

                                    if (orientation === 'horizontal') {
                                        // Wide-short card: avatar on left, text on right
                                        const tx = showAvatar ? 40 : 8;
                                        return (
                                            <>
                                                <text
                                                    x={tx}
                                                    y={line2 ? 18 : 22}
                                                    fontSize={isMobile ? 10 : 11}
                                                    fontWeight={fw}
                                                    fill="var(--card-foreground)"
                                                    style={{ pointerEvents: 'none' }}
                                                >
                                                    {line1}
                                                </text>
                                                {line2 && (
                                                    <text
                                                        x={tx}
                                                        y={30}
                                                        fontSize={isMobile ? 10 : 11}
                                                        fontWeight={fw}
                                                        fill="var(--card-foreground)"
                                                        style={{ pointerEvents: 'none' }}
                                                    >
                                                        {line2}
                                                    </text>
                                                )}
                                                {!!lifespan && (
                                                    <text
                                                        x={tx}
                                                        y={line2 ? 42 : (isMobile ? 34 : 40)}
                                                        fontSize={9}
                                                        fill="var(--muted-foreground)"
                                                        style={{ pointerEvents: 'none' }}
                                                    >
                                                        {lifespan}
                                                    </text>
                                                )}
                                            </>
                                        );
                                    } else {
                                        // Narrow-tall card: avatar top-center, text below centered
                                        const tcx = CARD_W / 2;
                                        const nameTopY = showAvatar ? (line2 ? 50 : 56) : (line2 ? 18 : 24);
                                        const nameLine2Y = nameTopY + 13;
                                        const datesY = line2 ? nameLine2Y + 14 : nameTopY + 16;
                                        return (
                                            <>
                                                <text
                                                    x={tcx}
                                                    y={nameTopY}
                                                    textAnchor="middle"
                                                    fontSize={isMobile ? 10 : 11}
                                                    fontWeight={fw}
                                                    fill="var(--card-foreground)"
                                                    style={{ pointerEvents: 'none' }}
                                                >
                                                    {line1}
                                                </text>
                                                {line2 && (
                                                    <text
                                                        x={tcx}
                                                        y={nameLine2Y}
                                                        textAnchor="middle"
                                                        fontSize={isMobile ? 10 : 11}
                                                        fontWeight={fw}
                                                        fill="var(--card-foreground)"
                                                        style={{ pointerEvents: 'none' }}
                                                    >
                                                        {line2}
                                                    </text>
                                                )}
                                                {!!lifespan && (
                                                    <text
                                                        x={tcx}
                                                        y={datesY}
                                                        textAnchor="middle"
                                                        fontSize={9}
                                                        fill="var(--muted-foreground)"
                                                        style={{ pointerEvents: 'none' }}
                                                    >
                                                        {lifespan}
                                                    </text>
                                                )}
                                            </>
                                        );
                                    }
                                })()}

                                {/* Expand/collapse ancestors button — right of card (horizontal) or above card (vertical) */}
                                {n.node.hasHiddenAncestors && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleExpandAncestors(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="expand-ancestors"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? CARD_W + 12 : CARD_W / 2}
                                            cy={orientation === 'horizontal' ? CARD_H / 2 : -12}
                                            r={9}
                                            fill="var(--card)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <ExpandAncestorIcon
                                            x={(orientation === 'horizontal' ? CARD_W + 12 : CARD_W / 2) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H / 2 : -12) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}
                                {!n.node.hasHiddenAncestors && expandedUp.has(n.node.id!) && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCollapseAncestors(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="collapse-ancestors"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? CARD_W + 12 : CARD_W / 2}
                                            cy={orientation === 'horizontal' ? CARD_H / 2 : -12}
                                            r={9}
                                            fill="var(--muted)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <CollapseAncestorIcon
                                            x={(orientation === 'horizontal' ? CARD_W + 12 : CARD_W / 2) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H / 2 : -12) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}

                                {/* Expand/collapse descendants button — left of card (horizontal) or below card (vertical) */}
                                {n.node.hasHiddenDescendants && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleExpandDescendants(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="expand-descendants"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? -12 : CARD_W / 2}
                                            cy={orientation === 'horizontal' ? CARD_H / 2 : CARD_H + 12}
                                            r={9}
                                            fill="var(--card)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <ExpandDescendantIcon
                                            x={(orientation === 'horizontal' ? -12 : CARD_W / 2) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H / 2 : CARD_H + 12) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}
                                {!n.node.hasHiddenDescendants && expandedDown.has(n.node.id!) && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCollapseDescendants(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="collapse-descendants"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? -12 : CARD_W / 2}
                                            cy={orientation === 'horizontal' ? CARD_H / 2 : CARD_H + 12}
                                            r={9}
                                            fill="var(--muted)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <CollapseDescendantIcon
                                            x={(orientation === 'horizontal' ? -12 : CARD_W / 2) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H / 2 : CARD_H + 12) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}

                                {/* Expand/collapse siblings button — hidden when all siblings are
                                    already visible in the direct ancestor/descendant line */}
                                {n.node.hasHiddenSiblings && !allSiblingsInDirectLine(n.node.id!) && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleExpandSiblings(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="expand-siblings"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? CARD_W / 2 : CARD_W + 12}
                                            cy={orientation === 'horizontal' ? CARD_H + 12 : CARD_H / 2}
                                            r={9}
                                            fill="var(--card)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <ExpandSiblingIcon
                                            x={(orientation === 'horizontal' ? CARD_W / 2 : CARD_W + 12) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H + 12 : CARD_H / 2) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}
                                {!n.node.hasHiddenSiblings && expandedSiblings.has(n.node.id!) && !allSiblingsInDirectLine(n.node.id!) && (
                                    <g
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCollapseSiblings(n.node.id!);
                                        }}
                                        className="cursor-pointer"
                                        data-testid="collapse-siblings"
                                    >
                                        <circle
                                            cx={orientation === 'horizontal' ? CARD_W / 2 : CARD_W + 12}
                                            cy={orientation === 'horizontal' ? CARD_H + 12 : CARD_H / 2}
                                            r={9}
                                            fill="var(--muted)"
                                            stroke="var(--muted-foreground)"
                                            strokeWidth={1.5}
                                            opacity={0.85}
                                        />
                                        <CollapseSiblingIcon
                                            x={(orientation === 'horizontal' ? CARD_W / 2 : CARD_W + 12) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H + 12 : CARD_H / 2) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Layout toggle + zoom controls */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/90 backdrop-blur-sm p-1 pointer-events-auto">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onOrientationChange('horizontal');
                    }}
                    title="Horizontal layout"
                    aria-pressed={orientation === 'horizontal'}
                    className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                        orientation === 'horizontal'
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                >
                    <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onOrientationChange('vertical');
                    }}
                    title="Vertical layout"
                    aria-pressed={orientation === 'vertical'}
                    className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${
                        orientation === 'vertical'
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    }`}
                >
                    <ArrowUp className="h-3.5 w-3.5" />
                </button>
            </div>

            {/* Hint */}
            <p className="absolute bottom-3 left-3 text-[10px] text-muted-foreground/50 pointer-events-none">
                Scroll to zoom · drag to pan · click card for options
            </p>

            {/* Person preview popover/sheet */}
            {selectedNode && selectedNode.node.id && (() => {
                const gNode = graphNodeMap.get(selectedNode.node.id!);
                const screenX = originX + pan.x + (selectedNode.x + CARD_W / 2) * scale;
                const screenY = originY + pan.y + (selectedNode.y + CARD_H) * scale + 8;
                return (
                    <PersonPreviewCard
                        personId={selectedNode.node.id!}
                        label={selectedNode.node.label}
                        sex={selectedNode.node.sex}
                        primaryAsset={gNode?.primaryAsset ?? null}
                        birthLine={lifeLine('b. ', gNode?.birthYear ?? null, gNode?.birthPlace ?? null)}
                        deathLine={lifeLine('d. ', gNode?.deathYear ?? null, gNode?.deathPlace ?? null)}
                        spouseLabel={resolveSpouseLabel(selectedNode.node.id!, links, graphNodeMap)}
                        screenX={screenX}
                        screenY={screenY}
                        containerWidth={dims.width}
                        containerHeight={dims.height}
                        isMobile={isMobile}
                        onClose={() => setSelectedNodeId(null)}
                        onMakeFocal={handleMakeFocal}
                        onViewProfile={handleViewProfile}
                    />
                );
            })()}
        </div>
    );
});

export default PedigreePanel;
