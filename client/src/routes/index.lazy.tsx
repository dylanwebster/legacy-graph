import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { forceCollide } from 'd3-force-3d';
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
const LS_KEY = 'fg-state-v5';  // bumped — fixed-X birth-year layout

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
// Vertical spacing for topological pre-sort
const GENERATION_GAP = 80;
// Vertical gap between separate family clusters
const CLUSTER_GAP = 100;
// Semantic link distances
const SPOUSE_LINK_DIST = 5;
const PARENT_CHILD_LINK_DIST = 100;

function yearToX(year: number, midYear: number): number {
    return (year - midYear) * PIXELS_PER_YEAR;
}

// Zoom thresholds for time axis resolution
const ZOOM_CENTURY_MAX = 0.5;   // k < 0.5 → century labels
const ZOOM_DECADE_MAX = 2.0;    // 0.5 ≤ k < 2.0 → decade labels
// k ≥ 2.0 → year labels

// ─── computeEffectiveBirthYears ───────────────────────────────────────────────

function computeEffectiveBirthYears(
    nodes: Array<{ id: string; birthYear?: number | null }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
): Map<string, number> {
    const GENERATION_GAP = 28;

    const parentIds = new Map<string, string[]>();  // childId → parentIds
    const childIds = new Map<string, string[]>();  // parentId → childIds
    const spouseIds = new Map<string, string[]>(); // personId → spouseIds

    for (const n of nodes) {
        parentIds.set(n.id, []);
        childIds.set(n.id, []);
        spouseIds.set(n.id, []);
    }

    for (const l of links) {
        if (l.type === 'parent_child') {
            const childId = typeof l.source === 'object' ? (l.source as any).id : l.source;
            const parentId = typeof l.target === 'object' ? (l.target as any).id : l.target;
            parentIds.get(childId)?.push(parentId);
            childIds.get(parentId)?.push(childId);
        } else if (l.type === 'spouse') {
            const a = typeof l.source === 'object' ? (l.source as any).id : l.source;
            const b = typeof l.target === 'object' ? (l.target as any).id : l.target;
            spouseIds.get(a)?.push(b);
            spouseIds.get(b)?.push(a);
        }
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
            for (const sid of spouseIds.get(n.id) ?? []) {
                const y = result.get(sid); if (y != null) estimates.push(y);
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
    const childIds = new Map<string, string[]>();  // parentId → childIds
    for (const n of nodes) { parentIds.set(n.id, []); childIds.set(n.id, []); }
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        const childId = getId(l.target); // swapped: target is child
        const parentId = getId(l.source); // swapped: source is parent
        parentIds.get(childId)?.push(parentId);
        childIds.get(parentId)?.push(childId);
    }

    const levels = new Map<string, number>();

    // Ancestors: only traverse upwards
    let queue: Array<{ id: string; level: number }> = [{ id: rootId, level: 0 }];
    levels.set(rootId, 0);
    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        for (const pid of parentIds.get(id) ?? []) {
            if (!levels.has(pid)) {
                levels.set(pid, level - 1);
                queue.push({ id: pid, level: level - 1 });
            }
        }
    }

    // Descendants: only traverse downwards
    queue = [{ id: rootId, level: 0 }];
    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
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
    try { localStorage.setItem(LS_KEY, JSON.stringify({ positions, zoom, rootPersonId })); } catch { }
}

// ─── Topological Y Pre-Sorter ─────────────────────────────────────────────────
// Deterministic initial Y placement that minimizes edge crossings before the
// physics simulation starts. Sorts siblings by birth year, keeps spouses
// adjacent, and gives disjoint family clusters non-overlapping Y bands.

function computeFamilyClusterY(
    nodes: Array<{ id: string; effectiveBirthYear?: number | null }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
): Map<string, number> {
    function getId(ref: string | object): string {
        return typeof ref === 'object' ? (ref as { id: string }).id : ref;
    }

    const nodeMap = new Map<string, { id: string; effectiveBirthYear?: number | null }>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Build adjacency maps
    const parentIds = new Map<string, string[]>();
    const childIds = new Map<string, string[]>();
    const spouseIds = new Map<string, string[]>();
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
        parentIds.set(n.id, []);
        childIds.set(n.id, []);
        spouseIds.set(n.id, []);
        adj.set(n.id, new Set());
    }
    for (const l of links) {
        if (l.type === 'parent_child') {
            const cId = getId(l.target); // target is child (already swapped in stableGraphData)
            const pId = getId(l.source); // source is parent
            parentIds.get(cId)?.push(pId);
            childIds.get(pId)?.push(cId);
            adj.get(cId)?.add(pId);
            adj.get(pId)?.add(cId);
        } else if (l.type === 'spouse') {
            const a = getId(l.source);
            const b = getId(l.target);
            spouseIds.get(a)?.push(b);
            spouseIds.get(b)?.push(a);
            adj.get(a)?.add(b);
            adj.get(b)?.add(a);
        }
    }

    // Find connected components
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const n of nodes) {
        if (visited.has(n.id)) continue;
        const comp: string[] = [];
        const stack = [n.id];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            visited.add(cur);
            comp.push(cur);
            for (const nb of adj.get(cur) ?? []) {
                if (!visited.has(nb)) stack.push(nb);
            }
        }
        components.push(comp);
    }

    // Sort components by size descending so the largest family is centered
    components.sort((a, b) => b.length - a.length);

    const result = new Map<string, number>();
    let clusterOffset = 0;

    for (const comp of components) {
        // Topological sort within each component:
        // Start from roots (no parents), BFS downward, sorting siblings by birth year
        const roots = comp.filter(id => (parentIds.get(id) ?? []).length === 0);
        const starts = roots.length > 0 ? roots : [comp[0]];

        // Sort starting roots by birth year
        starts.sort((a, b) => {
            const ya = nodeMap.get(a)?.effectiveBirthYear ?? 9999;
            const yb = nodeMap.get(b)?.effectiveBirthYear ?? 9999;
            return ya - yb;
        });

        const placed = new Map<string, number>(); // id → local Y slot
        let nextSlot = 0;

        // Place a node and its spouse(s) at the current slot
        const placeNodeWithSpouse = (id: string) => {
            if (placed.has(id)) return;
            placed.set(id, nextSlot);

            // Place spouses at the same slot
            for (const sid of spouseIds.get(id) ?? []) {
                if (!placed.has(sid)) {
                    placed.set(sid, nextSlot);
                }
            }
            nextSlot++;
        };

        // BFS: process parents first, then children sorted by birth year
        const queue = [...starts];
        for (const s of starts) placeNodeWithSpouse(s);

        while (queue.length > 0) {
            const id = queue.shift()!;

            // Get children, sort by birth year (older → higher/earlier slot)
            const children = (childIds.get(id) ?? []).filter(cid => !placed.has(cid));
            children.sort((a, b) => {
                const ya = nodeMap.get(a)?.effectiveBirthYear ?? 9999;
                const yb = nodeMap.get(b)?.effectiveBirthYear ?? 9999;
                return ya - yb;
            });

            for (const cid of children) {
                placeNodeWithSpouse(cid);
                queue.push(cid);
            }
        }

        // Catch any unvisited nodes in this component
        for (const id of comp) {
            if (!placed.has(id)) placeNodeWithSpouse(id);
        }

        // Convert slots to pixel positions
        for (const [id, slot] of placed) {
            result.set(id, clusterOffset + slot * GENERATION_GAP);
        }

        clusterOffset += nextSlot * GENERATION_GAP + CLUSTER_GAP;
    }

    // Center everything around Y=0
    const allY = [...result.values()];
    if (allY.length > 0) {
        const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
        for (const [id, y] of result) {
            result.set(id, y - centerY);
        }
    }

    return result;
}

// ─── Centering Y Force ────────────────────────────────────────────────────────
// Provides a very weak global centering force to keep the graph from drifting
// too far from the Y=0 axis, without distorting the family structure.

function makeCenteringYForce() {
    let nodes: SimNode[] = [];
    function force(alpha: number) {
        for (const node of nodes) {
            if (node.vy === undefined || node.y === undefined) continue;
            // Weak global centering
            node.vy += (0 - node.y) * 0.02 * alpha;
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
    const [rootSearch, setRootSearch] = useState('');
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

    // ── Year bounds ref (set by stableGraphData useMemo) ───────────────────
    const yearBoundsRef = useRef<{ minYear: number; maxYear: number; midYear: number } | null>(null);

    // ── Current zoom level for draw callbacks ──────────────────────────────
    const zoomLevelRef = useRef<number>(initialState.zoom?.k ?? 1);

    // ── Stable graph data with positions + effectiveBirthYear + fixed X ───
    const stableGraphData = useMemo(() => {
        if (!graphData) return null;
        const effectiveYears = computeEffectiveBirthYears(graphData.nodes, graphData.links);
        const pos = savedPositionsRef.current;

        // Compute year bounds for X positioning
        const years = [...effectiveYears.values()];
        let midYear = 1900;
        if (years.length > 0) {
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            midYear = (minYear + maxYear) / 2;
            yearBoundsRef.current = { minYear, maxYear, midYear };
        }

        return {
            nodes: graphData.nodes.map((n) => {
                const saved = pos[n.id];
                const effectiveBirthYear = effectiveYears.get(n.id) ?? null;
                const fixedX = yearToX(effectiveBirthYear ?? midYear, midYear);
                if (saved) {
                    return { ...n, effectiveBirthYear, x: fixedX, y: saved.y, fx: fixedX, fy: saved.y };
                }
                return { ...n, effectiveBirthYear, x: fixedX, fx: fixedX };
            }),
            links: graphData.links.map((l) => {
                const s = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
                const t = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
                if (l.type === 'parent_child') {
                    return {
                        ...l,
                        source: t, // Swap source to be parent
                        target: s, // Swap target to be child
                    };
                }
                return {
                    ...l,
                    source: s,
                    target: t,
                };
            }),
        };
    }, [graphData]);

    // Keep a ref to stableGraphData so stable callbacks can read it
    const stableGraphDataRef = useRef(stableGraphData);
    stableGraphDataRef.current = stableGraphData;

    const genLevels = useMemo<Map<string, number> | null>(() => {
        if (!rootPersonId || !stableGraphData) return null;
        return computeGenerationLevels(
            stableGraphData.nodes as Array<{ id: string }>,
            stableGraphData.links as Array<{ source: string | object; target: string | object; type: string }>,
            rootPersonId
        );
    }, [rootPersonId, stableGraphData]);

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
        const bounds = yearBoundsRef.current ?? { midYear: 1900, minYear: 1800, maxYear: 2000 };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fgAny = fg as any;

        // 1. Kill chaotic 2D forces — in a 1D-constrained layout they cause permanent tangles
        fg.d3Force('charge')?.strength?.(-5); // Very weak residual repulsion

        // Remove legacy forces
        fgAny.d3Force('xGravity', null);
        fgAny.d3Force('yGravity', null);
        fgAny.d3Force('hierarchy', null);
        fgAny.d3Force('generationY', null);
        fgAny.d3Force('centerY', null);

        // 2. Strict Y-collision to prevent node overlap without chaos
        fgAny.d3Force('collide', forceCollide(NODE_R * 8).iterations(5));

        // 3. Semantic link forces: spouses close together, generations spread
        // Configure the existing link force (don't create a new one — react-force-graph manages node refs)
        const existingLink = fg.d3Force('link');
        if (existingLink) {
            existingLink.distance?.((link: any) => link.type === 'spouse' ? SPOUSE_LINK_DIST : PARENT_CHILD_LINK_DIST);
            existingLink.strength?.((link: any) => link.type === 'spouse' ? 0.9 : 0.2);
        }

        // 4. Global centering force (keeps everything on screen without distortion)
        fgAny.d3Force('lineageY', makeCenteringYForce());

        const rootId = rootPersonIdRef.current;
        // ── Reheat on root change or reset ──
        if (shouldReheatRef.current) {
            shouldReheatRef.current = false;

            // Deterministic initial Y from topological pre-sorter
            const clusterY = computeFamilyClusterY(
                stableGraphData.nodes as SimNode[],
                stableGraphData.links as Array<{ source: string | object; target: string | object; type: string }>,
            );

            for (const node of stableGraphData.nodes) {
                const n = node as SimNode & { fx?: number; fy?: number };
                const fixedX = yearToX(n.effectiveBirthYear ?? bounds.midYear, bounds.midYear);
                n.fx = fixedX;  // Always lock X to birth year
                n.x = fixedX;
                delete n.fy;    // Free Y for simulation
                n.y = (clusterY.get(n.id as string) ?? 0) + (Math.random() - 0.5) * 10;
                n.vx = 0;
                n.vy = 0;
            }
            fg.d3ReheatSimulation();

            // Center view on focal node after simulation settles
            if (rootId) {
                setTimeout(() => {
                    const rootNode = (stableGraphDataRef.current?.nodes as SimNode[] | undefined)
                        ?.find((nd) => nd.id === rootId);
                    if (rootNode && typeof rootNode.x === 'number' && typeof rootNode.y === 'number') {
                        fgRef.current?.centerAt(rootNode.x, rootNode.y, 600);
                        fgRef.current?.zoom(1.4, 600);
                    } else {
                        fgRef.current?.zoomToFit(600, 80);
                    }
                }, 900);
            }
        } else {
            // First mount / API reload: ensure fx is set to birth year, restore saved fy
            const savedPos = savedPositionsRef.current;
            for (const node of stableGraphData.nodes) {
                const n = node as SimNode & { fx?: number; fy?: number };
                const fixedX = yearToX(n.effectiveBirthYear ?? bounds.midYear, bounds.midYear);
                n.fx = fixedX;
                n.x = fixedX;
                if (savedPos[n.id as string]) {
                    n.fy = savedPos[n.id as string].y;
                } else {
                    delete n.fy;
                }
            }
        }
    }, [stableGraphData, rootPersonId, genLevels]);

    // ── Node drag end — only pin Y (X stays locked to birth year) ──────────
    const handleNodeDragEnd = useCallback((node: NodeObject) => {
        const n = node as SimNode;
        if (typeof n.y === 'number') {
            (n as SimNode & { fy?: number }).fy = n.y;
        }
        // Keep fx locked to birth year
        const bounds = yearBoundsRef.current ?? { midYear: 1900, minYear: 1800, maxYear: 2000 };
        const fixedX = yearToX(n.effectiveBirthYear ?? bounds.midYear, bounds.midYear);
        (n as SimNode & { fx?: number }).fx = fixedX;
        n.x = fixedX;
        const gd = stableGraphDataRef.current;
        if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
    }, []);

    // ── Zoom tracking ──────────────────────────────────────────────────────
    const handleZoom = useCallback(({ k }: { k: number; x: number; y: number }) => {
        zoomLevelRef.current = k;

        // Skip saving the zoom if we haven't even processed our initial restore yet
        // The graph fires an initial onZoom on mount with default coords we don't want to persist
        if (!zoomRestoredRef.current && initialState.zoom) return;

        const center = fgRef.current?.centerAt();
        if (!center) return;

        zoomStateRef.current = { k, cx: center.x, cy: center.y };
        if (zoomSaveTimerRef.current) clearTimeout(zoomSaveTimerRef.current);
        zoomSaveTimerRef.current = setTimeout(() => {
            const gd = stableGraphDataRef.current;
            if (gd) saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, rootPersonIdRef.current);
        }, 300);
    }, [initialState.zoom]);

    // ── Restore zoom on mount ──────────────────────────────────────────────
    useEffect(() => {
        if (!stableGraphData || zoomRestoredRef.current) return;

        if (stableGraphData.nodes.length === 0) {
            zoomRestoredRef.current = true;
            return;
        }

        const saved = initialState.zoom;
        if (!saved) {
            zoomRestoredRef.current = true;
            return;
        }

        setTimeout(() => {
            fgRef.current?.zoom(saved.k, 0);
            fgRef.current?.centerAt(saved.cx, saved.cy, 0);

            // Allow 50ms for programmatic zoom to settle before marking as restored
            // This prevents default mounting zooms from overriding the restored zoom
            setTimeout(() => {
                zoomRestoredRef.current = true;
            }, 50);
        }, 100);
    }, [stableGraphData, initialState.zoom]);

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
        // We no longer reheat on root change — keep the stable topological layout
        // and just update the visual highlighting and camera focus.
        rootPersonIdRef.current = id;
        setRootPersonId(id);
        setRootSearch('');
        setRootFocused(false);

        const gd = stableGraphDataRef.current;
        if (gd) {
            saveGraphState(gd.nodes as SimNode[], zoomStateRef.current, id);

            // Focus camera on the new focal node immediately
            if (id && fgRef.current) {
                const node = (gd.nodes as SimNode[]).find(n => n.id === id);
                if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                    fgRef.current.centerAt(node.x, node.y, 600);
                    fgRef.current.zoom(1.4, 600);
                }
            }
        }
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
            const inLineage = genLevels ? genLevels.has(n.id as string) : true;
            const hasRoot = genLevels !== null;

            let alpha = 1;
            if (hasFilt && !isMatch) alpha = 0.12;
            if (hasRoot && !inLineage) alpha = Math.min(alpha, 0.12);

            const baseColor = sexColor(n.sex);
            const r = isMatch && hasFilt ? NODE_R * 1.3 : NODE_R;
            const coreR = Math.max(r, 2.5 / globalScale);

            ctx.globalAlpha = alpha;

            // Glow
            const grd = ctx.createRadialGradient(x, y, 0, x, y, coreR * 2.8);
            grd.addColorStop(0, baseColor + (isMatch && hasFilt ? '60' : '28'));
            grd.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(x, y, coreR * 2.8, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();

            // Highlight ring for matches when filter active
            if (isMatch && hasFilt) {
                ctx.beginPath();
                ctx.arc(x, y, coreR + 3, 0, Math.PI * 2);
                ctx.strokeStyle = baseColor + 'a0';
                ctx.lineWidth = 1.5 / globalScale;
                ctx.stroke();
            }

            // Core circle
            ctx.beginPath();
            ctx.arc(x, y, coreR, 0, Math.PI * 2);
            ctx.fillStyle = baseColor;
            ctx.fill();
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1.2 / globalScale;
            ctx.stroke();

            // Root person gold ring
            if (String(n.id) === rootPersonIdRef.current) {
                ctx.beginPath();
                ctx.arc(x, y, coreR + 4.5, 0, Math.PI * 2);
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

                const isActive = (isMatch || !hasFilt) && (inLineage || !hasRoot);
                ctx.fillStyle = isDark
                    ? (isActive ? 'rgba(248,250,252,0.88)' : 'rgba(248,250,252,0.25)')
                    : (isActive ? 'rgba(15,23,42,0.82)' : 'rgba(15,23,42,0.2)');

                const parts = n.label.split(' ');
                const shortLabel = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : n.label;
                ctx.fillText(shortLabel, x, y + coreR + 2 / globalScale);
                ctx.shadowBlur = 0;
            }

            ctx.globalAlpha = 1;
        },
        [matchingIds, genLevels, isDark],
    );

    const drawLink = useCallback(
        (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const l = link as SimLink;
            if (l.type !== 'spouse') return;
            const src = typeof l.source === 'object' ? (l.source as SimNode) : null;
            const tgt = typeof l.target === 'object' ? (l.target as SimNode) : null;
            if (!src || !tgt) return;

            const hasFilt = matchingIds !== null;
            const bothMatch = hasFilt
                ? (matchingIds!.has(src.id as string) && matchingIds!.has(tgt.id as string))
                : true;
            const hasRoot = genLevels !== null;
            const bothInLineage = hasRoot
                ? (genLevels!.has(src.id as string) && genLevels!.has(tgt.id as string))
                : true;
            const isEnded = l.status === 'divorced' || l.status === 'widowed';

            let alpha = 0.8;
            if (hasFilt && !bothMatch) alpha = 0.08;
            if (hasRoot && !bothInLineage) alpha = Math.min(alpha, 0.08);

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(src.x ?? 0, src.y ?? 0);
            ctx.lineTo(tgt.x ?? 0, tgt.y ?? 0);

            // Determine line width based on globalScale so it remains visible when zoomed out
            const lineWidth = Math.max(1.5, 1.5 / globalScale);

            ctx.setLineDash(isEnded ? [5 * lineWidth, 5 * lineWidth] : []);
            ctx.strokeStyle = isEnded ? 'rgba(251,146,60,0.75)' : 'rgba(251,191,36,0.85)';
            ctx.lineWidth = lineWidth;
            ctx.stroke();
            ctx.restore();
        },
        [matchingIds, genLevels],
    );

    const drawBackground = useCallback(
        (ctx: CanvasRenderingContext2D) => {
            // Subtle grid
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

            // Zoom-dependent time bands
            const bounds = yearBoundsRef.current;
            if (!bounds) return;
            const { midYear } = bounds;
            const k = zoomLevelRef.current;

            const transform = ctx.getTransform();
            const scale = transform.a;
            const translateX = transform.e;
            const physicalWidth = ctx.canvas.width;

            const minGraphX = -translateX / scale - 300;
            const maxGraphX = (physicalWidth - translateX) / scale + 300;
            const minYear = minGraphX / PIXELS_PER_YEAR + midYear;
            const maxYear = maxGraphX / PIXELS_PER_YEAR + midYear;

            if (k < ZOOM_CENTURY_MAX) {
                // Century bands
                const centuryStart = Math.floor(minYear / 100) * 100;
                for (let century = centuryStart; century <= maxYear; century += 100) {
                    const x1 = yearToX(century, midYear);
                    const x2 = yearToX(century + 100, midYear);
                    const idx = ((century / 100) % 2 + 2) % 2;
                    ctx.fillStyle = isDark
                        ? (idx === 0 ? 'rgba(255,255,255,0.020)' : 'rgba(255,255,255,0.008)')
                        : (idx === 0 ? 'rgba(0,0,0,0.020)' : 'rgba(0,0,0,0.008)');
                    ctx.fillRect(x1, -4000, x2 - x1, 8000);
                    ctx.beginPath(); ctx.moveTo(x1, -4000); ctx.lineTo(x1, 4000);
                    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            } else if (k < ZOOM_DECADE_MAX) {
                // Decade bands
                const decadeStart = Math.floor(minYear / 10) * 10;
                for (let decade = decadeStart; decade <= maxYear; decade += 10) {
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
            // No bands at year-level zoom (k >= ZOOM_DECADE_MAX) — too dense
        },
        [isDark],
    );

    // Dynamic time axis labels pinned to top of canvas in screen space
    const handleRenderFramePost = useCallback((ctx: CanvasRenderingContext2D) => {
        const bounds = yearBoundsRef.current;
        if (!bounds) return;
        const { midYear } = bounds;
        const transform = ctx.getTransform();
        const scale = transform.a;
        const translateX = transform.e;

        const cssWidth = dimsRef.current.width;
        if (!cssWidth) return;
        const physicalWidth = ctx.canvas.width;
        const dpr = physicalWidth / cssWidth;
        const k = zoomLevelRef.current;

        ctx.save();
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        // Solid background plate for the timeline
        ctx.fillStyle = isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)';
        ctx.fillRect(0, 0, cssWidth, 64);

        // Axis line at bottom of timeline plate
        ctx.beginPath();
        ctx.moveTo(0, 64);
        ctx.lineTo(cssWidth, 64);
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.4)' : 'rgba(71,85,105,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const labelColor = isDark ? 'rgba(241,245,249,0.95)' : 'rgba(15,23,42,0.95)';
        const tickColor = isDark ? 'rgba(148,163,184,0.5)' : 'rgba(71,85,105,0.5)';

        const minGraphX = -translateX / scale - 300;
        const maxGraphX = (physicalWidth - translateX) / scale + 300;
        const minYear = minGraphX / PIXELS_PER_YEAR + midYear;
        const maxYear = maxGraphX / PIXELS_PER_YEAR + midYear;

        const getScreenX = (graphX: number) => (graphX * scale + translateX) / dpr;

        if (k < ZOOM_CENTURY_MAX) {
            // Century labels
            ctx.font = 'bold 18px sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'center';
            ctx.fillStyle = labelColor;
            const centuryStart = Math.floor(minYear / 100) * 100;
            for (let century = centuryStart; century <= maxYear; century += 100) {
                const screenX = getScreenX(yearToX(century, midYear));
                if (screenX < -80 || screenX > cssWidth + 80) continue;
                // Tick mark
                ctx.beginPath();
                ctx.moveTo(screenX, 54);
                ctx.lineTo(screenX, 64);
                ctx.strokeStyle = tickColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillText(`${century}`, screenX, 48);
            }
        } else if (k < ZOOM_DECADE_MAX) {
            // Decade labels
            ctx.font = '600 15px sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'center';
            ctx.fillStyle = labelColor;
            const decadeStart = Math.floor(minYear / 10) * 10;
            for (let decade = decadeStart; decade <= maxYear; decade += 10) {
                const screenX = getScreenX(yearToX(decade, midYear));
                if (screenX < -60 || screenX > cssWidth + 60) continue;
                ctx.beginPath();
                ctx.moveTo(screenX, 56);
                ctx.lineTo(screenX, 64);
                ctx.strokeStyle = tickColor;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillText(`${decade}s`, screenX, 50);
            }
        } else {
            // Year labels
            ctx.font = '500 13px sans-serif';
            ctx.textBaseline = 'bottom';
            ctx.textAlign = 'center';
            ctx.fillStyle = labelColor;
            const yearStart = Math.floor(minYear);
            for (let yr = yearStart; yr <= maxYear; yr++) {
                const screenX = getScreenX(yearToX(yr, midYear));
                if (screenX < -40 || screenX > cssWidth + 40) continue;
                ctx.beginPath();
                ctx.moveTo(screenX, 58);
                ctx.lineTo(screenX, 64);
                ctx.strokeStyle = tickColor;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillText(`${yr}`, screenX, 52);
            }
        }

        ctx.restore();
    }, [isDark]);

    const getParentChildLinkColor = useCallback((link: any) => {
        if (link.type !== 'parent_child') return 'transparent';
        const srcId = typeof link.source === 'object' ? link.source.id : link.source;
        const tgtId = typeof link.target === 'object' ? link.target.id : link.target;

        const hasFilt = matchingIds !== null;
        const bothMatch = hasFilt ? (matchingIds.has(srcId) && matchingIds.has(tgtId)) : true;

        const hasRoot = genLevels !== null;
        const bothInLineage = hasRoot ? (genLevels.has(srcId) && genLevels.has(tgtId)) : true;

        let alpha = isDark ? 0.35 : 0.3;
        if (hasFilt && !bothMatch) alpha = 0.04;
        if (hasRoot && !bothInLineage) alpha = Math.min(alpha, 0.04);

        if (hasRoot && bothInLineage) {
            alpha = isDark ? 0.85 : 0.75;
            return isDark ? `rgba(167,139,250,${alpha})` : `rgba(139,92,246,${alpha})`;
        }

        return isDark ? `rgba(148,163,184,${alpha})` : `rgba(71,85,105,${alpha})`;
    }, [matchingIds, genLevels, isDark]);

    const getParentChildArrowColor = useCallback((link: any) => {
        if (link.type !== 'parent_child') return 'transparent';
        const srcId = typeof link.source === 'object' ? link.source.id : link.source;
        const tgtId = typeof link.target === 'object' ? link.target.id : link.target;

        const hasFilt = matchingIds !== null;
        const bothMatch = hasFilt ? (matchingIds.has(srcId) && matchingIds.has(tgtId)) : true;

        const hasRoot = genLevels !== null;
        const bothInLineage = hasRoot ? (genLevels.has(srcId) && genLevels.has(tgtId)) : true;

        let alpha = isDark ? 0.45 : 0.4;
        if (hasFilt && !bothMatch) alpha = 0.05;
        if (hasRoot && !bothInLineage) alpha = Math.min(alpha, 0.05);

        if (hasRoot && bothInLineage) {
            alpha = isDark ? 0.95 : 0.85;
            return isDark ? `rgba(167,139,250,${alpha})` : `rgba(139,92,246,${alpha})`;
        }

        return isDark ? `rgba(148,163,184,${alpha})` : `rgba(71,85,105,${alpha})`;
    }, [matchingIds, genLevels, isDark]);

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
        try { localStorage.removeItem(LS_KEY); } catch { /* empty */ }
        savedPositionsRef.current = {};
        zoomStateRef.current = null;
        // Trigger a full re-layout through the forces useEffect
        shouldReheatRef.current = true;
        const gd = stableGraphDataRef.current;
        if (gd && fgRef.current) {
            // Use topological pre-sorter for deterministic initial placement
            const clusterY = computeFamilyClusterY(
                gd.nodes as SimNode[],
                gd.links as Array<{ source: string | object; target: string | object; type: string }>,
            );
            const bounds = yearBoundsRef.current;
            for (const node of gd.nodes) {
                const n = node as SimNode & { fx?: number; fy?: number };
                const fixedX = bounds ? yearToX(n.effectiveBirthYear ?? bounds.midYear, bounds.midYear) : 0;
                n.x = fixedX;
                n.fx = fixedX;  // Keep X locked to birth year
                n.y = (clusterY.get(n.id as string) ?? 0) + (Math.random() - 0.5) * 10;
                n.vx = 0;
                n.vy = 0;
                delete n.fy;  // Free Y for simulation
            }
            fgRef.current.d3ReheatSimulation();
            fgRef.current.zoomToFit(600, 80);
        }
        // Preserve focal person across refresh — save it back after removeItem
        try { localStorage.setItem(LS_KEY, JSON.stringify({ positions: {}, zoom: null, rootPersonId: rootPersonIdRef.current })); } catch { /* empty */ }
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
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0 uppercase tracking-wider">Focal</span>
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
                        linkColor={getParentChildLinkColor}
                        linkWidth={(link: any) => link.type === 'parent_child' ? 1.5 : 0}
                        linkDirectionalArrowLength={(link: any) => link.type === 'parent_child' ? 5 : 0}
                        linkDirectionalArrowRelPos={1}
                        linkDirectionalArrowColor={getParentChildArrowColor}
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
