import { create } from 'zustand';

export type StoriesSortKey = 'date' | 'alpha' | 'created' | 'modified';
export type DashboardVizMode = 'force' | 'fan' | 'pedigree';

function loadInitialVizMode(): DashboardVizMode {
    if (typeof localStorage === 'undefined') return 'force';
    try {
        const raw = localStorage.getItem('dashboard-state-v1');
        if (raw) {
            const parsed = JSON.parse(raw) as { vizMode?: string };
            if (parsed.vizMode === 'fan' || parsed.vizMode === 'pedigree') return parsed.vizMode;
        }
    } catch { /* ignore */ }
    return 'force';
}

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    theme: 'dark' | 'light';
    storiesFeedFilter: string;
    storiesFeedSortKey: StoriesSortKey;
    storiesFeedSortOrder: 'asc' | 'desc';
    dashboardVizMode: DashboardVizMode;
    toggleSidebar: () => void;
    setSearchOpen: (open: boolean) => void;
    toggleTheme: () => void;
    setStoriesFeed: (filter: string, sortKey: StoriesSortKey, sortOrder: 'asc' | 'desc') => void;
    setDashboardVizMode: (mode: DashboardVizMode) => void;
}

export const useUIStore = create<UIState>((set) => ({
    storiesFeedFilter: '',
    storiesFeedSortKey: 'date',
    storiesFeedSortOrder: 'desc',
    setStoriesFeed: (filter, sortKey, sortOrder) => set({ storiesFeedFilter: filter, storiesFeedSortKey: sortKey, storiesFeedSortOrder: sortOrder }),
    sidebarOpen: false,
    searchOpen: false,
    theme: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSearchOpen: (open) => set({ searchOpen: open }),
    toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
        localStorage.setItem('theme', newTheme);
        return { theme: newTheme };
    }),
    dashboardVizMode: loadInitialVizMode(),
    setDashboardVizMode: (mode) => set({ dashboardVizMode: mode }),
}));
