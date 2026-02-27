import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { useRef, useEffect, useCallback, useState } from 'react';
import { useSystemStatus, useStats, usePeople, useGraphData } from '@/api/hooks';
import type { GraphNodeData, GraphLinkData } from '@/api/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, GitBranch, Clock, Activity, RefreshCw, Maximize2, Network } from 'lucide-react';
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

const SEX_COLOR: Record<string, string> = {
    M: '#60a5fa',   // blue-400
    F: '#f472b6',   // pink-400
    I: '#a78bfa',   // violet-400
    U: '#94a3b8',   // slate-400
};

function sexColor(sex: string): string {
    return SEX_COLOR[sex] ?? SEX_COLOR['U'];
}

// ─── Custom Y-Gravity Force ───────────────────────────────────────────────────

function makeYGravityForce(minYear: number, maxYear: number, spread: number) {
    let nodes: SimNode[] = [];
    const midYear = (minYear + maxYear) / 2;
    const yearRange = Math.max(maxYear - minYear, 1);

    function force(alpha: number) {
        for (const node of nodes) {
            if (node.birthYear != null) {
                const targetY = ((node.birthYear - midYear) / yearRange) * spread;
                if (node.vy !== undefined && node.y !== undefined) {
                    node.vy += (targetY - node.y) * 0.04 * alpha;
                }
            }
        }
    }

    (force as any).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
}

// ─── Dashboard Component ──────────────────────────────────────────────────────

function Dashboard() {
    const { data: status, isLoading: statusLoading } = useSystemStatus();
    const { data: statsData, isLoading: statsLoading } = useStats();
    const { data: peopleData, isLoading: peopleLoading } = usePeople({ limit: 1 });

    const isLoading = statusLoading || statsLoading || peopleLoading;

    return (
        <div className="h-full overflow-auto p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
                <p className="text-sm text-muted-foreground mt-1">Overview of your family graph</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Total People"
                    value={isLoading ? undefined : String(peopleData?.totalCount ?? 0)}
                />
                <StatCard
                    icon={GitBranch}
                    label="Relationships"
                    value={isLoading ? undefined : String(status?.edgeCount ?? 0)}
                />
                <StatCard
                    icon={Clock}
                    label="Last Modified"
                    value={isLoading ? undefined : (statsData?.lastModified ? new Date(statsData.lastModified).toLocaleDateString() : '—')}
                />
                <StatCard
                    icon={Activity}
                    label="Engine Status"
                    value={isLoading ? undefined : (status?.hydrationState ?? 'unknown')}
                    accent={status?.hydrationState === 'ready' ? 'green' : status?.hydrationState === 'loading' ? 'amber' : 'red'}
                />
            </div>

            {/* Force Graph */}
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
    const [dims, setDims] = useState({ width: 800, height: 520 });
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Responsive sizing
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setDims({
                    width: entry.contentRect.width,
                    height: Math.max(420, entry.contentRect.height),
                });
            }
        });
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // Apply custom D3 forces after graph mounts and data is ready
    useEffect(() => {
        if (!fgRef.current || !graphData?.nodes.length) return;
        const fg = fgRef.current;

        // Stronger repulsion
        fg.d3Force('charge')?.strength?.(-180);

        // Link distance
        fg.d3Force('link')?.distance?.(55);

        // Y gravity by birth year
        const years = graphData.nodes
            .map((n) => n.birthYear)
            .filter((y): y is number => y != null);

        if (years.length > 1) {
            const minYear = Math.min(...years);
            const maxYear = Math.max(...years);
            (fg as any).d3Force('yGravity', makeYGravityForce(minYear, maxYear, 420));
            fg.d3ReheatSimulation();
        }
    }, [graphData]);

    // ── Canvas drawing ─────────────────────────────────────────────────────

    const isDark = theme === 'dark';

    const drawNode = useCallback(
        (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const n = node as SimNode;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const isHovered = n.id === hoveredId;
            const color = sexColor(n.sex);
            const r = isHovered ? NODE_R * 1.35 : NODE_R;

            // Outer glow
            const glowR = r * 2.8;
            const grd = ctx.createRadialGradient(x, y, 0, x, y, glowR);
            grd.addColorStop(0, color + (isHovered ? '55' : '30'));
            grd.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(x, y, glowR, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();

            // Core circle
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)';
            ctx.lineWidth = isHovered ? 2 / globalScale : 1.5 / globalScale;
            ctx.stroke();

            // Label — show at zoom ≥ 0.45
            if (globalScale >= 0.45) {
                const fontSize = Math.max(9, 11 / globalScale);
                ctx.font = `${fontSize}px 'Fira Code', monospace`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                // Label shadow for legibility
                ctx.shadowColor = isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
                ctx.shadowBlur = 3;
                ctx.fillStyle = isDark ? 'rgba(248,250,252,0.9)' : 'rgba(15,23,42,0.85)';

                // Truncate to first name + last initial for space
                const parts = n.label.split(' ');
                const shortLabel = parts.length > 1
                    ? `${parts[0]} ${parts[parts.length - 1][0]}.`
                    : n.label;

                ctx.fillText(shortLabel, x, y + r + 2 / globalScale);
                ctx.shadowBlur = 0;
            }
        },
        [hoveredId, isDark],
    );

    const drawLink = useCallback(
        (link: LinkObject, ctx: CanvasRenderingContext2D, _globalScale: number) => {
            const l = link as SimLink;
            if (l.type !== 'spouse') return; // parent_child uses default renderer

            const src = typeof l.source === 'object' ? (l.source as SimNode) : null;
            const tgt = typeof l.target === 'object' ? (l.target as SimNode) : null;
            if (!src || !tgt) return;

            const x1 = src.x ?? 0, y1 = src.y ?? 0;
            const x2 = tgt.x ?? 0, y2 = tgt.y ?? 0;
            const isEnded = l.status === 'divorced' || l.status === 'widowed';

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.setLineDash(isEnded ? [5, 5] : []);
            ctx.strokeStyle = isEnded
                ? 'rgba(251, 146, 60, 0.55)'   // orange-400 for dissolved
                : 'rgba(251, 191, 36, 0.75)';   // amber-400 for married
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        },
        [],
    );

    const drawBackground = useCallback(
        (ctx: CanvasRenderingContext2D) => {
            // Very subtle grid lines to evoke a genealogy chart
            const step = 80;
            ctx.beginPath();
            for (let x = -4000; x < 4000; x += step) {
                ctx.moveTo(x, -4000);
                ctx.lineTo(x, 4000);
            }
            for (let y = -4000; y < 4000; y += step) {
                ctx.moveTo(-4000, y);
                ctx.lineTo(4000, y);
            }
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.025)';
            ctx.lineWidth = 1;
            ctx.stroke();
        },
        [isDark],
    );

    const handleNodeClick = useCallback(
        (node: NodeObject) => {
            navigate({ to: '/people/$id', params: { id: String(node.id) } });
        },
        [navigate],
    );

    const handleNodeHover = useCallback((node: NodeObject | null) => {
        setHoveredId(node ? String(node.id) : null);
    }, []);

    const handleZoomFit = () => {
        fgRef.current?.zoomToFit(400, 60);
    };

    // ── Render states ───────────────────────────────────────────────────────

    const isEmpty = !isLoading && !isError && (graphData?.nodes.length ?? 0) === 0;
    const nodeCount = graphData?.nodes.length ?? 0;
    const linkCount = graphData?.links.length ?? 0;

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2.5">
                    <Network className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold tracking-wide">Family Graph</span>
                    {!isLoading && !isError && nodeCount > 0 && (
                        <span className="text-xs text-muted-foreground font-mono ml-1">
                            {nodeCount} people · {linkCount} connections
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => refetch()}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        title="Refresh graph"
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={handleZoomFit}
                        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                        title="Fit to view"
                    >
                        <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>

            {/* Graph canvas area */}
            <div ref={containerRef} className="relative w-full" style={{ height: 520 }}>
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center gap-4 p-8">
                        <div className="w-full space-y-3">
                            <Skeleton className="h-4 w-3/4 mx-auto" />
                            <Skeleton className="h-4 w-1/2 mx-auto" />
                            <Skeleton className="h-4 w-2/3 mx-auto" />
                        </div>
                    </div>
                )}

                {isError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center space-y-2 text-muted-foreground">
                            <GitBranch className="h-10 w-10 mx-auto opacity-30" />
                            <p className="text-sm">Could not load graph data</p>
                            <button
                                onClick={() => refetch()}
                                className="text-xs underline underline-offset-2 hover:text-foreground transition-colors"
                            >
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
                            <p className="text-xs opacity-70">Add family members to see the graph come alive</p>
                        </div>
                    </div>
                )}

                {!isLoading && !isError && nodeCount > 0 && (
                    <ForceGraph2D
                        ref={fgRef as any}
                        width={dims.width}
                        height={dims.height}
                        backgroundColor="transparent"
                        graphData={graphData as any}
                        nodeId="id"
                        nodeLabel="label"
                        nodeRelSize={NODE_R}
                        nodeCanvasObject={drawNode}
                        nodeCanvasObjectMode={() => 'replace'}
                        linkColor={(link: any) => link.type === 'parent_child'
                            ? (isDark ? 'rgba(148,163,184,0.4)' : 'rgba(71,85,105,0.35)')
                            : 'transparent' // spouse drawn by linkCanvasObject
                        }
                        linkWidth={(link: any) => link.type === 'parent_child' ? 1.5 : 0}
                        linkDirectionalArrowLength={(link: any) => link.type === 'parent_child' ? 5 : 0}
                        linkDirectionalArrowRelPos={1}
                        linkDirectionalArrowColor={(link: any) => link.type === 'parent_child'
                            ? (isDark ? 'rgba(148,163,184,0.5)' : 'rgba(71,85,105,0.45)')
                            : 'transparent'
                        }
                        linkCanvasObject={drawLink}
                        linkCanvasObjectMode={(link: any) => link.type === 'spouse' ? 'replace' : undefined}
                        onNodeClick={handleNodeClick}
                        onNodeHover={handleNodeHover}
                        onRenderFramePre={drawBackground}
                        cooldownTicks={120}
                        d3AlphaDecay={0.025}
                        d3VelocityDecay={0.3}
                        minZoom={0.15}
                        maxZoom={8}
                        enableNodeDrag
                        enableZoomInteraction
                        enablePanInteraction
                    />
                )}

                {/* Legend */}
                {!isLoading && !isError && nodeCount > 0 && (
                    <div className="absolute bottom-3 right-3 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-3 py-2 text-xs space-y-1.5">
                        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider mb-1">Legend</p>
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                            <span className="text-muted-foreground">Male</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-pink-400 shrink-0" />
                            <span className="text-muted-foreground">Female</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full bg-violet-400 shrink-0" />
                            <span className="text-muted-foreground">Other</span>
                        </div>
                        <div className="border-t border-border pt-1.5 mt-0.5 space-y-1">
                            <div className="flex items-center gap-1.5">
                                <svg width="18" height="6" className="shrink-0">
                                    <line x1="0" y1="3" x2="14" y2="3" stroke="rgba(148,163,184,0.6)" strokeWidth="1.5" markerEnd="url(#arrow)" />
                                </svg>
                                <span className="text-muted-foreground">Parent–child</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <svg width="18" height="6" className="shrink-0">
                                    <line x1="0" y1="3" x2="18" y2="3" stroke="rgba(251,191,36,0.8)" strokeWidth="1.5" />
                                </svg>
                                <span className="text-muted-foreground">Married</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <svg width="18" height="6" className="shrink-0">
                                    <line x1="0" y1="3" x2="18" y2="3" stroke="rgba(251,146,60,0.7)" strokeWidth="1.5" strokeDasharray="4 3" />
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

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value?: string; accent?: string }) {
    return (
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/20 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
                <div className="text-xs text-muted-foreground font-medium">{label}</div>
                {value === undefined ? (
                    <Skeleton className="h-5 w-16 mt-0.5" />
                ) : (
                    <div className={`text-lg font-bold ${accent === 'green' ? 'text-emerald-500' : accent === 'amber' ? 'text-amber-500' : accent === 'red' ? 'text-red-500' : ''}`}>
                        {value}
                    </div>
                )}
            </div>
        </div>
    );
}
