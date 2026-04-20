// Single localStorage key covering all three viz modes.
const DS_KEY = 'dashboard-state-v1';

// Legacy key — read once during migration from the force-only state shape.
const LEGACY_FORCE_KEY = 'fg-state-v5';

export interface ViewState {
    scale: number;
    pan: { x: number; y: number };
}

export interface DashboardState {
    rootPersonId: string | null;
    vizMode: 'force' | 'fan' | 'pedigree';
    positions: Record<string, { x: number; y: number }>;
    zoom: { k: number; cx: number; cy: number } | null;
    fanMaxGen: number;
    pedigreeOrientation: 'horizontal' | 'vertical';
    fanView: ViewState | null;
    pedigreeView: ViewState | null;
    pedigreeExpanded: { up: string[]; down: string[]; siblings: string[] } | null;
}

export const DS_DEFAULTS: DashboardState = {
    rootPersonId: null,
    vizMode: 'force',
    positions: {},
    zoom: null,
    fanMaxGen: 4,
    pedigreeOrientation: 'horizontal',
    fanView: null,
    pedigreeView: null,
    pedigreeExpanded: null,
};

export function loadDashboardState(): DashboardState {
    try {
        const raw = localStorage.getItem(DS_KEY);
        if (raw) return { ...DS_DEFAULTS, ...(JSON.parse(raw) as Partial<DashboardState>) };
        const old = localStorage.getItem(LEGACY_FORCE_KEY);
        if (old) {
            const p = JSON.parse(old) as {
                positions?: Record<string, { x: number; y: number }>;
                zoom?: { k: number; cx: number; cy: number } | null;
                rootPersonId?: string | null;
            };
            const migrated = {
                ...DS_DEFAULTS,
                positions: p.positions ?? {},
                zoom: p.zoom ?? null,
                rootPersonId: p.rootPersonId ?? null,
            };
            saveDashboardState(migrated);
            return migrated;
        }
    } catch { /* ignore */ }
    return { ...DS_DEFAULTS };
}

export function saveDashboardState(state: DashboardState): void {
    try { localStorage.setItem(DS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
