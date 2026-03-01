import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useGraphData, usePerson } from '@/api/hooks';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import { PersonHoverContent } from '@/components/PersonChip';
import { Skeleton } from '@/components/ui/skeleton';
import { GitBranch, RefreshCw, Scan, Maximize2, Minimize2, Network, Search, X } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';

export const Route = createLazyFileRoute('/')({
    component: Dashboard,
});

// ─── Types ───────────────────────────────────────────────────────────────────

type SimNode = NodeObject & GraphNodeData & {
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    effectiveBirthYear?: number | null;
};

type SimLink = LinkObject & GraphLinkData;

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_R = 6;
const LS_KEY = 'fg-state-v4';  // bumped — generation-Y layout

const SEX_COLOR: Record<string, string> = {
    M: '#60a5fa',
    F: '#f472b6',
    I: '#a78bfa',
    U: '#94a3b8',
};

function sexColor(sex: string): string {
    return SEX_COLOR[sex] ?? SEX_COLOR['U'];
}

// Fixed scale: 1 year = 14 canvas units (decade = 140 units wide — gives better temporal spread)
const PIXELS_PER_YEAR = 14;
// Vertical gap between consecutive generations when a root person is set
const GENERATION_GAP = 140;

function yearToX(year: number, midYear: number): number {
    return (year - midYear) * PIXELS_PER_YEAR;
}

// ─── computeEffectiveBirthYears ───────────────────────────────────────────────

function computeEffectiveBirthYears(
    nodes: Array<{ id: string; birthYear?: number | null }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
): Map<string, number> {
    const GENERATION_GAP = 28;

    const parentIds = new Map<string, string[]>();  // childId → parentIds
    const childIds  = new Map<string, string[]>();  // parentId → childIds
    for (const n of nodes) { parentIds.set(n.id, []); childIds.set(n.id, []); }
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        const childId  = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const parentId = typeof l.target === 'object' ? (l.target as any).id : l.target;
        parentIds.get(childId)?.push(parentId);
        childIds.get(parentId)?.push(childId);
    }

    const result = new Map<string, number>();
    for (const n of nodes) if (n.birthYear != null) result.set(n.id, n.birthYear);

    // Iterative BFS until stable (max 10 passes)
    let changed = true;
    for (let i = 0; i < 10 && changed; i++) {
        changed = false;
        for (const n of nodes) {
            if (result.has(n.id)) continue;
            const estimates: number[] = [];
            for (const pid of parentIds.get(n.id) ?? []) {
                const y = result.get(pid); if (y != null) estimates.push(y + GENERATION_GAP);
            }
            for (const cid of childIds.get(n.id) ?? []) {
                const y = result.get(cid); if (y != null) estimates.push(y - GENERATION_GAP);
            }
            if (estimates.length > 0) {
                result.set(n.id, estimates.reduce((a, b) => a + b, 0) / estimates.length);
                changed = true;
            }
        }
    }

    // Final fallback: dataset mean for truly isolated unknown nodes
    const knownYears = [...result.values()];
    if (knownYears.length > 0) {
        const fallback = knownYears.reduce((a, b) => a + b, 0) / knownYears.length;
        for (const n of nodes) if (!result.has(n.id)) result.set(n.id, fallback);
    }
    return result;
}

// ─── computeGenerationLevels ─────────────────────────────────────────────────
// BFS from rootId to assign Y-generation levels:
//   root=0, parents=-1, grandparents=-2, children=+1, grandchildren=+2, …
// Returns a Map<nodeId, level>; nodes not reachable from root are absent.

function computeGenerationLevels(
    nodes: Array<{ id: string }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
    rootId: string,
): Map<string, number> {
    function getId(ref: string | object): string {
        return typeof ref === 'object' ? (ref as { id: string }).id : ref;
    }
    const parentIds = new Map<string, string[]>();  // childId → parentIds
    const childIds  = new Map<string, string[]>();  // parentId → childIds
    for (const n of nodes) { parentIds.set(n.id, []); childIds.set(n.id, []); }
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        const childId  = getId(l.source);
        const parentId = getId(l.target);
        parentIds.get(childId)?.push(parentId);
        childIds.get(parentId)?.push(childId);
    }

    const levels = new Map<string, number>();
    const queue: Array<{ id: string; level: number }> = [{ id: rootId, level: 0 }];
    levels.set(rootId, 0);
    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        for (const pid of parentIds.get(id) ?? []) {
            if (!levels.has(pid)) {
                levels.set(pid, level - 1);
                queue.push({ id: pid, level: level - 1 });
            }
        }
        for (const cid of childIds.get(id) ?? []) {
            if (!levels.has(cid)) {
                levels.set(cid, level + 1);
                queue.push({ id: cid, level: level + 1 });
            }
        }
    }
    return levels;
}

// ─── Graph State ──────────────────────────────────────────────────────────────

interface GraphState {
    positions: Record<string, { x: number; y: number }>;
    zoom: { k: number; cx: number; cy: number } | null;
    rootPersonId: string | null;
}

function loadGraphState(): GraphState {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return { positions: {}, zoom: null, rootPersonId: null };
        const p = JSON.parse(raw) as Partial<GraphState>;
        return { positions: p.positions ?? {}, zoom: p.zoom ?? null, rootPersonId: p.rootPersonId ?? null };
    } catch {
        return { positions: {}, zoom: null, rootPersonId: null };
    }
}

function saveGraphState(
    nodes: SimNode[],
    zoom: { k: number; cx: number; cy: number } | null,
    rootPersonId: string | null,
) {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
        if (typeof n.x === 'number' && typeof n.y === 'number')
            positions[n.id as string] = { x: n.x, y: n.y };
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify({ positions, zoom, rootPersonId })); } catch {}
}

// ─── X-Gravity Force ─────────────────────────────────────────────────────────

function makeXGravityForce(midYear: number, strength = 0.1) {
    let nodes: SimNode[] = [];
    function force(alpha: number) {
        for (const node of nodes) {
            const ey = node.effectiveBirthYear;
            if (ey != null && node.vx !== undefined && node.x !== undefined) {
                const targetX = yearToX(ey, midYear);
                node.vx += (targetX - node.x) * strength * alpha;
            }
        }
    }
    (force as any).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
}

// ─── Generation Y Force ───────────────────────────────────────────────────────
// Pulls each node toward targetY = level * generationGap.
// Only affects nodes present in the levels map.

function makeGenerationYForce(
    levels: Map<string, number>,
    generationGap: number,
    strength = 0.2,
) {
    let nodes: SimNode[] = [];
    function force(alpha: number) {
        for (const node of nodes) {
            const level = levels.get(node.id as string);
            if (level === undefined || node.vy === undefined || node.y === undefined) continue;
            node.vy += (level * generationGap - node.y) * strength * alpha;
        }
    }
    (force as any).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
}

// ─── Center-Y Force ───────────────────────────────────────────────────────────
// Softly pulls all nodes (or a subset when excludeIds is given) toward Y=0.
// Used in no-root mode to prevent the graph from drifting too far vertically.

function makeCenterYForce(excludeIds: Set<string> | null = null, strength = 0.04) {
    let nodes: SimNode[] = [];
    function force(alpha: number) {
        for (const node of nodes) {
            if (excludeIds?.has(node.id as string)) continue;
            if (node.vy !== undefined && node.y !== undefined) {
                node.vy += (0 - node.y) * strength * alpha;
            }
        }
    }
    (force as any).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
}

// ─── Hover Card ───────────────────────────────────────────────────────────────

function GraphNodeHoverCard({ id }: { id: string }) {
    const { data: person } = usePerson(id);
    return <PersonHoverContent id={id} person={person} />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
    return (
        <div className="h-full overflow-auto p-6 space-y-4">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-1">Interactive family graph</p>
            </div>
            <FamilyGraphPanel />
        </div>
    );
}

// ─── Family Graph Panel ───────────────────────────────────────────────────────

function FamilyGraphPanel() {
    const { data: graphData, isLoading, isError, refetch } = useGraphData();
    const navigate = useNavigate();
    const theme = useUIStore((s) => s.theme);

    const fgRef = useRef<ForceGraphMethods | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ width: 800, height: 600 });
    const [isFullscreen, setIsFullscreen] = useState(false);

    // ── Search state ───────────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // ── Root person picker state ───────────────────────────────────────────
    const [rootSearch, setRootSearch]   = useState('');
    const [rootFocused, setRootFocused] = useState(false);
    const rootPickerRef = useRef<HTMLDivElement>(null);

    // ── Hover state ────────────────────────────────────────────────────────
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const hoveredNodeIdRef = useRef<string | null>(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

    // ── Position + zoom persistence ────────────────────────────────────────
    const initialState = useMemo(() => loadGraphState(), []);
    const savedPositionsRef = useRef<Record<string, { x: number; y: number }>>(
        initialState.positions
    );
    const zoomStateRef = useRef<{ k: number; cx: number; cy: number } | null>(
        initialState.zoom
    );
    const zoomRestoredRef = useRef(false);
    const zoomSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dimsRef = useRef(dims);
    dimsRef.current = dims;

    // ── Root person state ──────────────────────────────────────────────────
    const [rootPersonId, setRootPersonId] = useState<string | null>(initialState.rootPersonId);
    const rootPersonIdRef = useRef<string | null>(initialState.rootPersonId);
    // Set to true when root changes or reset fires; forces useEffect re-layouts
    const shouldReheatRef = useRef(false);

    // ── Year bounds ref (set by D3 forces useEffect) ───────────────────────
    const yearBoundsRef = useRef<{ minYear: number; maxYear: number; midYear: number } | null>(null);

    // ── Stable graph data with positions + effectiveBirthYear ─────────────
    const stableGraphData = useMemo(() => {
        if (!graphData) return null;
        const effectiveYears = computeEffectiveBirthYears(graphData.nodes, graphData.links);
        const pos = savedPositionsRef.current;
        return {
            nodes: graphData.nodes.map((n) => {
                const saved = pos[n.id];
                const effectiveBirthYear = effectiveYears.get(n.id) ?? null;
                return saved
                    ? { ...n, effectiveBirthYear, x: saved.x, y: saved.y, fx: saved.x, fy: saved.y }
                    : { ...n, effectiveBirthYear };
            }),
            links: graphData.links.map((l) => ({
                ...l,
                source: typeof l.source === 'object' ? (l.source as any).id : l.source,
                target: typeof l.target === 'object' ? (l.target as any).id : l.target,
            })),
        };
    }, [graphData]);

    // Keep a ref to stableGraphData so stable callbacks can read it
    const stableGraphDataRef = useRef(stableGraphData);
    stableGraphDataRef.current = stableGraphData;

    const handleEngineStop = useCallback(() => {
        const gd = stableGraphDataRef.current;
        if (!gd) return;
        saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
    }, []);

    // ── Responsive sizing ──────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            const e = entries[0];
            if (e) setDims({ width: e.contentRect.width, height: Math.max(500, e.contentRect.height) });
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // ── D3 forces ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!fgRef.current || !stableGraphData?.nodes.length) return;
        const fg = fgRef.current;

        fg.d3Force('charge')?.strength?.(-400);
        fg.d3Force('link')?.distance?.(80);

        // ── X gravity: pull every node toward its birth-year X position ──
        const years = stableGraphData.nodes
            .map((n) => (n as SimNode).effectiveBirthYear)
            .filter((y): y is number => y != null);

        let midYear = 1900;
        if (years.length > 1) {
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            midYear = (minYear + maxYear) / 2;
            yearBoundsRef.current = { minYear, maxYear, midYear };
        }
        (fg as any).d3Force('xGravity', makeXGravityForce(midYear, 0.12));
        (fg as any).d3Force('yGravity', null);   // remove v2 yGravity if present
        (fg as any).d3Force('hierarchy', null);  // remove v3 hierarchy force if present

        // ── Y force: generation-based when root set, soft centering otherwise ──
        const rootId = rootPersonIdRef.current;
        let genLevels: Map<string, number> | null = null;
        if (rootId) {
            genLevels = computeGenerationLevels(
                stableGraphData.nodes as Array<{ id: string }>,
                stableGraphData.links as Array<{ source: string | object; target: string | object; type: string }>,
                rootId,
            );
            (fg as any).d3Force('generationY', makeGenerationYForce(genLevels, GENERATION_GAP, 0.2));
            // Softly center disconnected nodes that have no assigned generation
            (fg as any).d3Force('centerY', makeCenterYForce(new Set(genLevels.keys()), 0.04));
        } else {
            (fg as any).d3Force('generationY', null);
            (fg as any).d3Force('centerY', makeCenterYForce(null, 0.05));
        }

        // ── Reheat on root change (shouldReheatRef set by handleSetRoot) ──
        if (shouldReheatRef.current) {
            shouldReheatRef.current = false;
            const bounds = yearBoundsRef.current ?? { midYear: 1900, minYear: 1800, maxYear: 2000 };

            for (const node of stableGraphData.nodes) {
                const n = node as any;
                delete n.fx;
                delete n.fy;
                // Set X from birth year, Y from generation level (or random spread)
                n.x = yearToX((n as SimNode).effectiveBirthYear ?? bounds.midYear, bounds.midYear);
                if (genLevels) {
                    const level = genLevels.get(n.id as string);
                    n.y = level !== undefined ? level * GENERATION_GAP : (Math.random() - 0.5) * GENERATION_GAP * 2;
                } else {
                    n.y = (Math.random() - 0.5) * 600;
                }
                n.vx = 0;
                n.vy = 0;
            }
            fg.d3ReheatSimulation();

            // After simulation settles a bit, center view on root node
            if (rootId) {
                setTimeout(() => {
                    const rootNode = (stableGraphDataRef.current?.nodes as SimNode[] | undefined)
                        ?.find((n) => n.id === rootId);
                    if (rootNode && typeof rootNode.x === 'number' && typeof rootNode.y === 'number') {
                        fgRef.current?.centerAt(rootNode.x, rootNode.y, 600);
                        fgRef.current?.zoom(1.4, 600);
                    } else {
                        fgRef.current?.zoomToFit(600, 80);
                    }
                }, 900);
            }
        } else {
            // First mount / API reload: unpin only nodes that have no saved position
            const savedPos = savedPositionsRef.current;
            for (const node of stableGraphData.nodes) {
                const n = node as any;
                if (!savedPos[n.id as string]) {
                    delete n.fx;
                    delete n.fy;
                }
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stableGraphData, rootPersonId]);

    // ── Node drag end — pin dragged node ───────────────────────────────────
    const handleNodeDragEnd = useCallback((node: NodeObject) => {
        const n = node as SimNode;
        if (typeof n.x === 'number' && typeof n.y === 'number') {
            (n as any).fx = n.x;
            (n as any).fy = n.y;
        }
        const gd = stableGraphDataRef.current;
        if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
    }, []);

    // ── Zoom tracking ──────────────────────────────────────────────────────
    const handleZoom = useCallback(({ k, x, y }: { k: number; x: number; y: number }) => {
        const w = dimsRef.current.width;
        const h = dimsRef.current.height;
        const cx = (w / 2 - x) / k;
        const cy = (h / 2 - y) / k;
        zoomStateRef.current = { k, cx, cy };
        if (zoomSaveTimerRef.current) clearTimeout(zoomSaveTimerRef.current);
        zoomSaveTimerRef.current = setTimeout(() => {
            const gd = stableGraphDataRef.current;
            if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
        }, 300);
    }, []);

    // ── Restore zoom on mount ──────────────────────────────────────────────
    useEffect(() => {
        if (!stableGraphData?.nodes.length || zoomRestoredRef.current) return;
        zoomRestoredRef.current = true;
        const saved = zoomStateRef.current;
        if (!saved) return;
        requestAnimationFrame(() => {
            fgRef.current?.zoom(saved.k, 0);
            fgRef.current?.centerAt(saved.cx, saved.cy, 0);
        });
    }, [stableGraphData]);

    // ── Cleanup on unmount ─────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            const gd = stableGraphDataRef.current;
            if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
            if (zoomSaveTimerRef.current) clearTimeout(zoomSaveTimerRef.current);
        };
    }, []);

    // ── Close dropdowns on outside click ──────────────────────────────────
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setSearchFocused(false);
            }
            if (rootPickerRef.current && !rootPickerRef.current.contains(e.target as Node)) {
                setRootFocused(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // ── Mouse tracking for hover tooltip ──────────────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const onMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        };
        container.addEventListener('mousemove', onMove);
        return () => container.removeEventListener('mousemove', onMove);
    }, []);

    // ── Root person callbacks ──────────────────────────────────────────────
    const handleSetRoot = useCallback((id: string | null) => {
        // Signal the forces useEffect to re-layout the graph on next render
        shouldReheatRef.current = true;
        rootPersonIdRef.current = id;
        setRootPersonId(id);  // triggers forces useEffect via dep array
        setRootSearch('');
        setRootFocused(false);

        const gd = stableGraphDataRef.current;
        if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, id);
    }, []);

    const rootDropdownNodes = useMemo<SimNode[]>(() => {
        if (!rootFocused || !stableGraphData) return [];
        const q = rootSearch.trim().toLowerCase();
        const all = stableGraphData.nodes as SimNode[];
        return (q ? all.filter(n => n.label.toLowerCase().includes(q)) : all).slice(0, 8);
    }, [rootFocused, rootSearch, stableGraphData]);

    // ── Search derived state ───────────────────────────────────────────────
    const matchingIds = useMemo<Set<string> | null>(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || !stableGraphData) return null;
        const ids = new Set<string>();
        for (const n of stableGraphData.nodes) {
            if ((n as SimNode).label.toLowerCase().includes(q)) ids.add(n.id as string);
        }
        return ids;
    }, [searchQuery, stableGraphData]);

    const dropdownNodes = useMemo<SimNode[]>(() => {
        if (!matchingIds || !stableGraphData) return [];
        return (stableGraphData.nodes as SimNode[]).filter((n) => matchingIds.has(n.id as string)).slice(0, 8);
    }, [matchingIds, stableGraphData]);

    const focusNode = useCallback(
        (node: SimNode) => {
            if (!fgRef.current) return;
            const live = (stableGraphDataRef.current?.nodes as SimNode[] | undefined)
                ?.find((n) => n.id === node.id);
            if (live && typeof live.x === 'number' && typeof live.y === 'number') {
                fgRef.current.centerAt(live.x, live.y, 450);
                fgRef.current.zoom(2.8, 450);
            }
            setSearchQuery('');
            setSearchFocused(false);
        },
        [],
    );

    // ── Node hover ─────────────────────────────────────────────────────────
    const handleNodeHover = useCallback((node: NodeObject | null) => {
        const id = node ? String(node.id) : null;
        hoveredNodeIdRef.current = id;
        setHoveredNodeId(id);
    }, []);

    // ── Canvas drawing ─────────────────────────────────────────────────────
    const isDark = theme === 'dark';

    const drawNode = useCallback(
        (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const n = node as SimNode;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const isMatch = matchingIds ? matchingIds.has(n.id as string) : true;
            const hasFilt = matchingIds !== null;
            const alpha = hasFilt ? (isMatch ? 1 : 0.12) : 1;
            const color = sexColor(n.sex);
            const r = isMatch && hasFilt ? NODE_R * 1.3 : NODE_R;

            ctx.globalAlpha = alpha;

            // Glow
            const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 2.8);
            grd.addColorStop(0, color + (isMatch && hasFilt ? '60' : '28'));
            grd.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();

            // Highlight ring for matches when filter active
            if (isMatch && hasFilt) {
                ctx.beginPath();
                ctx.arc(x, y, r + 3, 0, Math.PI * 2);
                ctx.strokeStyle = color + 'a0';
                ctx.lineWidth = 1.5 / globalScale;
                ctx.stroke();
            }

            // Core circle
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1.2 / globalScale;
            ctx.stroke();

            // Root person gold ring
            if (String(n.id) === rootPersonIdRef.current) {
                ctx.beginPath();
                ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
                ctx.strokeStyle = '#fbbf24';  // amber-400
                ctx.lineWidth = 2.5 / globalScale;
                ctx.stroke();
            }

            // Label
            if (globalScale >= 0.5) {
                const fontSize = Math.max(8, 10 / globalScale);
                ctx.font = `${fontSize}px 'Fira Code', monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.shadowColor = isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';
                ctx.shadowBlur = 3;
                ctx.fillStyle = isDark
                    ? (isMatch || !hasFilt ? 'rgba(248,250,252,0.88)' : 'rgba(248,250,252,0.25)')
                    : (isMatch || !hasFilt ? 'rgba(15,23,42,0.82)' : 'rgba(15,23,42,0.2)');

                const parts = n.label.split(' ');
                const shortLabel = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : n.label;
                ctx.fillText(shortLabel, x, y + r + 2 / globalScale);
                ctx.shadowBlur = 0;
            }

            ctx.globalAlpha = 1;
        },
        [matchingIds, isDark, rootPersonId],
    );

    const drawLink = useCallback(
        (link: LinkObject, ctx: CanvasRenderingContext2D, _globalScale: number) => {
            const l = link as SimLink;
            if (l.type !== 'spouse') return;
            const src = typeof l.source === 'object' ? (l.source as SimNode) : null;
            const tgt = typeof l.target === 'object' ? (l.target as SimNode) : null;
            if (!src || !tgt) return;

            const hasFilt = matchingIds !== null;
            const bothMatch = hasFilt
                ? (matchingIds!.has(src.id as string) && matchingIds!.has(tgt.id as string))
                : true;
            const isEnded = l.status === 'divorced' || l.status === 'widowed';

            ctx.save();
            ctx.globalAlpha = hasFilt ? (bothMatch ? 0.85 : 0.08) : 0.8;
            ctx.beginPath();
            ctx.moveTo(src.x ?? 0, src.y ?? 0);
            ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);
            ctx.setLineDash(isEnded ? [5, 5] : []);
            ctx.strokeStyle = isEnded ? 'rgba(251,146,60,0.75)' : 'rgba(251,191,36,0.85)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        },
        [matchingIds],
    );

    const drawBackground = useCallback(
        (ctx: CanvasRenderingContext2D) => {
            const step = 80;
            ctx.beginPath();
            for (let x = -4000; x < 4000; x += step) {
                ctx.moveTo(x, -4000); ctx.lineTo(x, 4000);
            }
            for (let y = -4000; y < 4000; y += step) {
                ctx.moveTo(-4000, y); ctx.lineTo(4000, y);
            }
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.022)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Decade band columns (graph space)
            const bounds = yearBoundsRef.current;
            if (bounds) {
                const { minYear, maxYear, midYear } = bounds;
                const decadeStart = Math.floor(minYear / 10) * 10;
                for (let decade = decadeStart; decade <= maxYear + 10; decade += 10) {
                    const x1 = yearToX(decade, midYear);
                    const x2 = yearToX(decade + 10, midYear);
                    ctx.fillStyle = isDark
                        ? (decade % 20 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.006)')
                        : (decade % 20 === 0 ? 'rgba(0,0,0,0.018)' : 'rgba(0,0,0,0.006)');
                    ctx.fillRect(x1, -4000, x2 - x1, 8000);
                    ctx.beginPath(); ctx.moveTo(x1, -4000); ctx.lineTo(x1, 4000);
                    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.055)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        },
        [isDark],
    );

    // Decade labels pinned to the top of the canvas in screen space
    const handleRenderFramePost = useCallback((ctx: CanvasRenderingContext2D) => {
        const bounds = yearBoundsRef.current;
        if (!bounds) return;
        const { minYear, maxYear, midYear } = bounds;
        const transform = ctx.getTransform();  // DOMMatrix with current zoom+pan
        const scale = transform.a;
        const translateX = transform.e;

        ctx.save();
        ctx.resetTransform();

        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isDark ? 'rgba(148,163,184,0.6)' : 'rgba(71,85,105,0.6)';

        const decadeStart = Math.floor(minYear / 10) * 10;
        const canvasWidth = dimsRef.current.width;
        for (let decade = decadeStart; decade <= maxYear + 10; decade += 10) {
            const graphX = yearToX(decade, midYear);
            const screenX = scale * graphX + translateX;
            if (screenX < -40 || screenX > canvasWidth + 40) continue;
            ctx.fillText(`${decade}s`, screenX, 18);
        }
        ctx.restore();
    }, [isDark]);

    const handleNodeClick = useCallback(
        (node: NodeObject) => navigate({ to: '/people/$id', params: { id: String(node.id) } }),
        [navigate],
    );

    // ── Fullscreen ─────────────────────────────────────────────────────────
    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    const toggleFullscreen = useCallback(async () => {
        if (!panelRef.current) return;
        try {
            if (!document.fullscreenElement) {
                await panelRef.current.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch { /* fullscreen not supported */ }
    }, []);

    // ── Refresh (clears saved layout so graph re-settles from scratch) ─────
    const handleRefresh = useCallback(() => {
        try { localStorage.removeItem(LS_KEY); } catch {}
        savedPositionsRef.current = {};
        zoomStateRef.current = null;
        zoomRestoredRef.current = false;
        // Trigger a full re-layout through the forces useEffect
        shouldReheatRef.current = true;
        const gd = stableGraphDataRef.current;
        if (gd && fgRef.current) {
            // Pre-scatter nodes so D3 starts fresh
            const bounds = yearBoundsRef.current;
            for (const node of gd.nodes) {
                const n = node as any;
                n.x = bounds ? yearToX((n as SimNode).effectiveBirthYear ?? bounds.midYear, bounds.midYear) : (Math.random() - 0.5) * 1000;
                n.y = (Math.random() - 0.5) * 500;
                n.vx = 0;
                n.vy = 0;
                delete n.fx;
                delete n.fy;
            }
            fgRef.current.d3ReheatSimulation();
            fgRef.current.zoomToFit(600, 80);
        }
        // Preserve root person across refresh — save it back after removeItem
        try { localStorage.setItem(LS_KEY, JSON.stringify({ positions: {}, zoom: null, rootPersonId: rootPersonIdRef.current })); } catch {}
        refetch();
    }, [refetch]);

    const handleResetView = () => fgRef.current?.zoomToFit(400, 60);

    // ── Render ─────────────────────────────────────────────────────────────
    const isEmpty = !isLoading && !isError && (stableGraphData?.nodes.length ?? 0) === 0;
    const nodeCount = stableGraphData?.nodes.length ?? 0;
    const linkCount = stableGraphData?.links.length ?? 0;
    const matchCount = matchingIds?.size ?? 0;

    const rootNodeLabel = useMemo(() => {
        if (!rootPersonId || !stableGraphData) return '';
        return (stableGraphData.nodes as SimNode[]).find(n => n.id === rootPersonId)?.label ?? '';
    }, [rootPersonId, stableGraphData]);

    return (
        <div ref={panelRef} className={`border border-border bg-card overflow-visible ${isFullscreen ? 'rounded-none' : 'rounded-xl'}`}>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <Network className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold tracking-wide">Family Graph</span>

                {!isLoading && !isError && nodeCount > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">
                        {nodeCount} people · {linkCount} connections
                    </span>
                )}

                {/* Root person picker — ml-auto anchors the right-side controls */}
                {!isLoading && !isError && nodeCount > 0 && (
                    <div ref={rootPickerRef} className="relative ml-auto">
                        <div className="flex items-center gap-1.5 h-7 rounded-md border border-border bg-muted/30 px-2 focus-within:border-ring/50 focus-within:bg-muted/50 transition-colors">
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0 uppercase tracking-wider">Root</span>
                            <input
                                type="text"
                                value={rootFocused ? rootSearch : (rootPersonId ? rootNodeLabel : '')}
                                onChange={(e) => setRootSearch(e.target.value)}
                                onFocus={() => { setRootFocused(true); setRootSearch(''); }}
                                placeholder="none"
                                className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
                            />
                            {rootPersonId && !rootFocused && (
                                <button onClick={() => handleSetRoot(null)} className="text-muted-foreground hover:text-foreground">
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                        {rootFocused && rootDropdownNodes.length > 0 && (
                            <div className="absolute left-0 top-full mt-1.5 w-56 z-50 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                                {rootDropdownNodes.map((node) => (
                                    <button
                                        key={node.id as string}
                                        onMouseDown={(e) => { e.preventDefault(); handleSetRoot(node.id as string); }}
                                        className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-muted/40 transition-colors"
                                    >
                                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: sexColor(node.sex) }} />
                                        <span className="flex-1 min-w-0 truncate">{node.label}</span>
                                        {node.birthYear && <span className="text-muted-foreground font-mono shrink-0">b.&nbsp;{node.birthYear}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Search */}
                {!isLoading && !isError && nodeCount > 0 && (
                    <div ref={searchRef} className="relative">
                        <div className="flex items-center gap-1.5 h-7 rounded-md border border-border bg-muted/30 px-2 focus-within:border-ring/50 focus-within:bg-muted/50 transition-colors">
                            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setSearchFocused(true)}
                                placeholder="Find person…"
                                className="w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                            />
                            {searchQuery && (
                                <>
                                    {matchingIds && (
                                        <span className="text-[10px] font-mono text-muted-foreground">{matchCount}</span>
                                    )}
                                    <button onClick={() => { setSearchQuery(''); setSearchFocused(false); }}
                                        className="text-muted-foreground hover:text-foreground">
                                        <X className="h-3 w-3" />
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Dropdown */}
                        {searchFocused && dropdownNodes.length > 0 && (
                            <div className="absolute right-0 top-full mt-1.5 w-56 z-50 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
                                {dropdownNodes.map((node) => (
                                    <button
                                        key={node.id as string}
                                        onMouseDown={(e) => { e.preventDefault(); focusNode(node); }}
                                        className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-muted/40 transition-colors"
                                    >
                                        <span
                                            className="inline-block w-2 h-2 rounded-full shrink-0"
                                            style={{ background: sexColor(node.sex) }}
                                        />
                                        <span className="flex-1 min-w-0 truncate">{node.label}</span>
                                        {node.birthYear && (
                                            <span className="text-muted-foreground font-mono shrink-0">b.&nbsp;{node.birthYear}</span>
                                        )}
                                    </button>
                                ))}
                                {matchCount > 8 && (
                                    <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                                        +{matchCount - 8} more — refine your search
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Controls */}
                <div className={`flex items-center gap-1 ${nodeCount > 0 ? '' : 'ml-auto'}`}>
                    <button onClick={handleRefresh}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        title="Reload graph (resets layout)">
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={handleResetView}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        title="Reset zoom and center">
                        <Scan className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={toggleFullscreen}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div ref={containerRef} className={`relative w-full overflow-hidden ${isFullscreen ? '' : 'rounded-b-xl'}`} style={{ height: isFullscreen ? 'calc(100dvh - 44px)' : 600 }}>
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center p-16">
                        <div className="w-full space-y-3">
                            <Skeleton className="h-3 w-3/4 mx-auto" />
                            <Skeleton className="h-3 w-1/2 mx-auto" />
                            <Skeleton className="h-3 w-2/3 mx-auto" />
                        </div>
                    </div>
                )}

                {isError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center space-y-2 text-muted-foreground">
                            <GitBranch className="h-10 w-10 mx-auto opacity-30" />
                            <p className="text-sm">Could not load graph data</p>
                            <button onClick={() => refetch()}
                                className="text-xs underline underline-offset-2 hover:text-foreground transition-colors">
                                Try again
                            </button>
                        </div>
                    </div>
                )}

                {isEmpty && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center space-y-2 text-muted-foreground">
                            <Network className="h-10 w-10 mx-auto opacity-25" />
                            <p className="text-sm font-medium">No people yet</p>
                            <p className="text-xs opacity-60">Add family members to see the graph</p>
                        </div>
                    </div>
                )}

                {!isLoading && !isError && nodeCount > 0 && (
                    <ForceGraph2D
                        ref={fgRef as any}
                        width={dims.width}
                        height={dims.height}
                        backgroundColor="transparent"
                        graphData={stableGraphData as any}
                        nodeId="id"
                        nodeLabel="label"
                        nodeRelSize={NODE_R}
                        nodeCanvasObject={drawNode}
                        nodeCanvasObjectMode={() => 'replace'}
                        linkColor={(link: any) =>
                            link.type === 'parent_child'
                                ? (isDark ? 'rgba(148,163,184,0.35)' : 'rgba(71,85,105,0.3)')
                                : 'transparent'
                        }
                        linkWidth={(link: any) => link.type === 'parent_child' ? 1.5 : 0}
                        linkDirectionalArrowLength={(link: any) => link.type === 'parent_child' ? 5 : 0}
                        linkDirectionalArrowRelPos={1}
                        linkDirectionalArrowColor={(link: any) =>
                            link.type === 'parent_child'
                                ? (isDark ? 'rgba(148,163,184,0.45)' : 'rgba(71,85,105,0.4)')
                                : 'transparent'
                        }
                        linkCanvasObject={drawLink}
                        linkCanvasObjectMode={(link: any) => link.type === 'spouse' ? 'replace' : undefined}
                        onNodeClick={handleNodeClick}
                        onNodeDragEnd={handleNodeDragEnd}
                        onNodeHover={handleNodeHover}
                        onZoom={handleZoom}
                        onRenderFramePre={drawBackground}
                        onRenderFramePost={handleRenderFramePost as any}
                        onEngineStop={handleEngineStop}
                        cooldownTicks={150}
                        d3AlphaDecay={0.022}
                        d3VelocityDecay={0.3}
                        minZoom={0.1}
                        maxZoom={10}
                        enableNodeDrag
                        enableZoomInteraction
                        enablePanInteraction
                    />
                )}

                {/* Hover tooltip */}
                {hoveredNodeId && (
                    <div
                        className="pointer-events-none absolute z-50"
                        style={{
                            left: tooltipPos.x + 16,
                            top: tooltipPos.y + 16,
                            transform: tooltipPos.x > dims.width - 280 ? 'translateX(calc(-100% - 32px))' : undefined,
                        }}
                    >
                        <div className="w-64 rounded-md border border-border bg-popover p-4 shadow-md text-popover-foreground">
                            <GraphNodeHoverCard id={hoveredNodeId} />
                        </div>
                    </div>
                )}

                {/* Legend */}
                {!isLoading && !isError && nodeCount > 0 && (
                    <div className="absolute bottom-3 right-3 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-3 py-2 text-xs space-y-1.5 pointer-events-none">
                        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider mb-1.5">Legend</p>
                        <LegendRow color="#60a5fa" label="Male" />
                        <LegendRow color="#f472b6" label="Female" />
                        <LegendRow color="#a78bfa" label="Other" />
                        <div className="border-t border-border pt-1.5 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="6" className="shrink-0">
                                    <defs>
                                        <marker id="arr" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
                                            <path d="M0,0 L4,2 L0,4 Z" fill="rgba(148,163,184,0.6)" />
                                        </marker>
                                    </defs>
                                    <line x1="0" y1="3" x2="16" y2="3" stroke="rgba(148,163,184,0.6)" strokeWidth="1.5" markerEnd="url(#arr)" />
                                </svg>
                                <span className="text-muted-foreground">Parent–child</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <svg width="20" height="6" className="shrink-0">
                                    <line x1="0" y1="3" x2="20" y2="3" stroke="rgba(251,191,36,0.85)" strokeWidth="1.5" />
                                </svg>
                                <span className="text-muted-foreground">Married</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <svg width="20" height="6" className="shrink-0">
                                    <line x1="0" y1="3" x2="20" y2="3" stroke="rgba(251,146,60,0.75)" strokeWidth="1.5" strokeDasharray="4 3" />
                                </svg>
                                <span className="text-muted-foreground">Divorced / widowed</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function LegendRow({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-muted-foreground">{label}</span>
        </div>
    );
}
