function LegendRow({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-muted-foreground">{label}</span>
        </div>
    );
}

export function GraphLegend() {
    return (
        <div className="absolute bottom-3 right-3 rounded-lg border border-border bg-card/90 backdrop-blur-sm px-3 py-2 text-xs space-y-1.5 pointer-events-none">
            <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider mb-1.5">Legend</p>
            <LegendRow color="#60a5fa" label="Male" />
            <LegendRow color="#f472b6" label="Female" />
            <LegendRow color="#94a3b8" label="Unknown / Other" />
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
                <div className="flex items-center gap-2">
                    <svg width="20" height="6" className="shrink-0">
                        <line x1="0" y1="3" x2="20" y2="3" stroke="rgba(139,92,246,0.85)" strokeWidth="2" />
                    </svg>
                    <span className="text-muted-foreground">Lineage highlight</span>
                </div>
            </div>
        </div>
    );
}
