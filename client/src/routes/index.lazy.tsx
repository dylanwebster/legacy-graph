import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useGraphData } from '@/api/hooks';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
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
};

type SimLink = LinkObject & GraphLinkData;

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_R = 6;
const LS_KEY = 'fg-positions-v1';

const SEX_COLOR: Record<string, string> = {
    M: '#60a5fa',
    F: '#f472b6',
    I: '#a78bfa',
    U: '#94a3b8',
};

function sexColor(sex: string): string {
    return SEX_COLOR[sex] ?? SEX_COLOR['U'];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadSavedPositions(): Record<string, { x: number; y: number }> {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    } catch {
        return {};
    }
}

function savePositions(nodes: SimNode[]) {
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
        if (typeof n.x === 'number' && typeof n.y === 'number') {
            out[n.id as string] = { x: n.x, y: n.y };
        }
    }
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch {}
}

// ─── Y-Gravity Force ─────────────────────────────────────────────────────────

function makeYGravityForce(minYear: number, maxYear: number, spread: number) {
    let nodes: SimNode[] = [];
    const midYear = (minYear + maxYear) / 2;
    const yearRange = Math.max(maxYear - minYear, 1);

    function force(alpha: number) {
        for (const node of nodes) {
            if (node.birthYear != null && node.vy !== undefined && node.y !== undefined) {
                const targetY = ((node.birthYear - midYear) / yearRange) * spread;
                node.vy += (targetY - node.y) * 0.04 * alpha;
            }
        }
    }
    (force as any).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
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

    // ── Position persistence ───────────────────────────────────────────────
    // Read once synchronously at mount — no state update, no re-render
    const savedPositionsRef = useRef<Record<string, { x: number; y: number }>>(
        loadSavedPositions()
    );

    // Stable graph data with restored positions injected into nodes.
    // Nodes with saved positions are initially PINNED (fx/fy) so D3 cannot
    // move them during the brief window before our forces useEffect fires.
    //
    // Links MUST have their source/target normalized back to string IDs here.
    // D3 mutates link objects in-place, replacing IDs with actual node references.
    // Those mutated link objects stay in TanStack Query's cache, so on remount
    // `graphData.links` still points to the old node objects from the previous
    // simulation. Normalizing ensures D3 re-resolves edges against the new nodes.
    const stableGraphData = useMemo(() => {
        if (!graphData) return null;
        const pos = savedPositionsRef.current;
        return {
            nodes: graphData.nodes.map((n) => {
                const saved = pos[n.id];
                return saved
                    ? { ...n, x: saved.x, y: saved.y, fx: saved.x, fy: saved.y }
                    : { ...n };
            }),
            links: graphData.links.map((l) => ({
                ...l,
                source: typeof l.source === 'object' ? (l.source as any).id : l.source,
                target: typeof l.target === 'object' ? (l.target as any).id : l.target,
            })),
        };
    }, [graphData]);

    // Keep a ref to stableGraphData so the stable onEngineStop callback can read it
    const stableGraphDataRef = useRef(stableGraphData);
    stableGraphDataRef.current = stableGraphData;

    const handleEngineStop = useCallback(() => {
        const gd = stableGraphDataRef.current;
        if (!gd) return;
        savePositions(gd.nodes as SimNode[]);
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

        fg.d3Force('charge')?.strength?.(-200);
        fg.d3Force('link')?.distance?.(55);

        const years = stableGraphData.nodes
            .map((n) => (n as SimNode).birthYear)
            .filter((y): y is number => y != null);

        if (years.length > 1) {
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            (fg as any).d3Force('yGravity', makeYGravityForce(minYear, maxYear, 480));
        }

        // Unpin nodes that were pinned for initial-frame stability.
        // For nodes with saved positions this is a near-equilibrium release —
        // net force ≈ 0 so they barely drift. For new nodes (no saved position)
        // fx/fy were never set, so the delete is a safe no-op.
        // We deliberately do NOT call d3ReheatSimulation(): the simulation
        // auto-starts at alpha=1 on mount, which is sufficient for new layouts.
        // Calling it on remount would re-run the full physics from scratch and
        // produce a different (unstable) arrangement every time.
        for (const node of stableGraphData.nodes) {
            delete (node as any).fx;
            delete (node as any).fy;
        }
    }, [stableGraphData]);

    // ── Close dropdown on outside click ───────────────────────────────────
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setSearchFocused(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

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
        [matchingIds, isDark],
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
        },
        [isDark],
    );

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
        // Directly scatter existing D3 node positions to random values.
        // Because react-force-graph-2d merges graphData by node ID (copying
        // existing x/y onto updated nodes), simply refetching won't produce a
        // new layout. Instead we mutate the live node objects that D3 already
        // holds in-place, then reheat the simulation. This triggers a full
        // re-settle without needing to remount the component (which would
        // break the stable-navigation behaviour).
        const gd = stableGraphDataRef.current;
        if (gd && fgRef.current) {
            for (const node of gd.nodes) {
                const n = node as any;
                n.x = (Math.random() - 0.5) * 1000;
                n.y = (Math.random() - 0.5) * 1000;
                n.vx = 0;
                n.vy = 0;
                delete n.fx;
                delete n.fy;
            }
            fgRef.current.d3ReheatSimulation();
        }
        refetch();
    }, [refetch]);

    const handleResetView = () => fgRef.current?.zoomToFit(400, 60);

    // ── Render ─────────────────────────────────────────────────────────────
    const isEmpty = !isLoading && !isError && (stableGraphData?.nodes.length ?? 0) === 0;
    const nodeCount = stableGraphData?.nodes.length ?? 0;
    const linkCount = stableGraphData?.links.length ?? 0;
    const matchCount = matchingIds?.size ?? 0;

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

                {/* Search */}
                {!isLoading && !isError && nodeCount > 0 && (
                    <div ref={searchRef} className="relative ml-auto">
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
                        onRenderFramePre={drawBackground}
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
