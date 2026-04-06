import { useRef, useState, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, MoreHorizontal, Minus } from 'lucide-react';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import {
    buildFamilyTree,
    computeAdaptiveTreeLayout,
} from '@/utils/genealogyLayout';
import { sexColor as sexStroke } from '@/utils/sexColors';
import { PersonPreviewCard, lifeLine, resolveSpouseLabel } from './PersonPreviewCard';

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

const CARD_W = 192;
const CARD_H = 64;
const NAME_MAX = 24; // max chars per name line before truncation

/**
 * Split a full name into [line1, line2|null].
 * Short names stay on one line. Long names split given-name(s) / surname.
 * Each line is capped at NAME_MAX chars.
 */
function splitNameLines(label: string): [string, string | null] {
    const cap = (s: string) => s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1) + '…' : s;
    if (label.length <= NAME_MAX) return [label, null];
    const parts = label.split(' ');
    if (parts.length === 1) return [cap(label), null];
    const surname = parts[parts.length - 1];
    const given = parts.slice(0, -1).join(' ');
    return [cap(given), cap(surname)];
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
    const viewSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const expandSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
        resetView: () => { setScale(1); setPan({ x: 0, y: 0 }); },
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

    // Debounced view state persistence
    useEffect(() => {
        if (!onViewChange) return;
        if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
        viewSaveTimerRef.current = setTimeout(() => {
            onViewChange({ scale, pan });
        }, 300);
        return () => {
            if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
        };
    }, [scale, pan, onViewChange]);

    // Debounced expansion state persistence
    useEffect(() => {
        if (!onExpandChange) return;
        if (expandSaveTimerRef.current) clearTimeout(expandSaveTimerRef.current);
        expandSaveTimerRef.current = setTimeout(() => {
            onExpandChange({
                up: Array.from(expandedUp),
                down: Array.from(expandedDown),
                siblings: Array.from(expandedSiblings),
            });
        }, 300);
        return () => {
            if (expandSaveTimerRef.current) clearTimeout(expandSaveTimerRef.current);
        };
    }, [expandedUp, expandedDown, expandedSiblings, onExpandChange]);

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
            const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            const newScale = Math.max(0.15, Math.min(4, scale * factor));
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
            // Don't capture — let clicks on buttons and SVG elements work naturally
            dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
        },
        [pan],
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            // Only enter drag mode after exceeding threshold
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
        const layout = computeAdaptiveTreeLayout(tree, orientation);
        return { treeNodes: layout.nodes, treeConnectors: layout.connectors };
    }, [rootPersonId, nodes, links, orientation, ancestorDepth, descendantDepth,
        expandedUp, expandedDown, expandedSiblings]);

    // Node lookup for graph data (birthYear, primaryAsset)
    const graphNodeMap = useMemo(
        () => new Map(nodes.map(n => [n.id, n])),
        [nodes],
    );

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

    if (!rootPersonId) {
        return (
            <div
                ref={containerRef}
                className="relative w-full h-full flex items-center justify-center"
            >
                <div className="text-center space-y-2 text-muted-foreground">
                    <ArrowRight className="h-10 w-10 mx-auto opacity-25" />
                    <p className="text-sm font-medium">Select a focal person</p>
                    <p className="text-xs opacity-60">Use the Focal picker above to choose a root person</p>
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
                <g transform={transform}>
                    {/* Connectors */}
                    {treeConnectors.map((c) => (
                        <path
                            key={c.id}
                            d={c.path}
                            fill="none"
                            stroke="var(--foreground)"
                            strokeWidth={c.kind === 'sibling' ? 1 : 1.5}
                            strokeDasharray={c.kind === 'sibling' ? '5 4' : undefined}
                            opacity={c.kind === 'sibling' ? 0.3 : 0.55}
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
                                style={{ pointerEvents: 'all', filter: 'url(#card-shadow)' }}
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

                                {/* Root indicator */}
                                {isRoot && (
                                    <rect
                                        x={0}
                                        y={0}
                                        width={4}
                                        height={CARD_H}
                                        rx={2}
                                        fill="var(--primary)"
                                    />
                                )}

                                {/* Sex-color dot */}
                                <circle
                                    cx={CARD_W - 10}
                                    cy={10}
                                    r={3}
                                    fill={sexStroke(n.node.sex)}
                                    style={{ pointerEvents: 'none' }}
                                />

                                {/* Name (1 or 2 lines) + lifespan */}
                                {(() => {
                                    const [line1, line2] = splitNameLines(n.node.label);
                                    const tx = isRoot ? 12 : 8;
                                    const y1 = line2 ? 17 : 21;
                                    return (
                                        <>
                                            <text
                                                x={tx}
                                                y={y1}
                                                fontSize={11}
                                                fontWeight={isRoot ? 600 : 500}
                                                fill="var(--card-foreground)"
                                                style={{ pointerEvents: 'none' }}
                                            >
                                                {line1}
                                            </text>
                                            {line2 && (
                                                <text
                                                    x={tx}
                                                    y={31}
                                                    fontSize={11}
                                                    fontWeight={isRoot ? 600 : 500}
                                                    fill="var(--card-foreground)"
                                                    style={{ pointerEvents: 'none' }}
                                                >
                                                    {line2}
                                                </text>
                                            )}
                                            {!!lifespan && (
                                                <text
                                                    x={tx}
                                                    y={line2 ? 47 : 36}
                                                    fontSize={9}
                                                    fill="var(--muted-foreground)"
                                                    style={{ pointerEvents: 'none' }}
                                                >
                                                    {lifespan}
                                                </text>
                                            )}
                                        </>
                                    );
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

                                {/* Expand/collapse siblings button */}
                                {n.node.hasHiddenSiblings && (
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
                                        <MoreHorizontal
                                            x={(orientation === 'horizontal' ? CARD_W / 2 : CARD_W + 12) - 5}
                                            y={(orientation === 'horizontal' ? CARD_H + 12 : CARD_H / 2) - 5}
                                            width={10}
                                            height={10}
                                            className="text-foreground"
                                        />
                                    </g>
                                )}
                                {!n.node.hasHiddenSiblings && expandedSiblings.has(n.node.id!) && (
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
                                        <Minus
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
