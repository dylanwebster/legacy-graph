import { create } from 'zustand';

export type StoriesSortKey = 'date' | 'alpha' | 'created' | 'modified';

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    theme: 'dark' | 'light';
    storiesFeedFilter: string;
    storiesFeedSortKey: StoriesSortKey;
    storiesFeedSortOrder: 'asc' | 'desc';
    toggleSidebar: () => void;
    setSearchOpen: (open: boolean) => void;
    toggleTheme: () => void;
    setStoriesFeed: (filter: string, sortKey: StoriesSortKey, sortOrder: 'asc' | 'desc') => void;
}

export const useUIStore = create<UIState>((set) => ({
    storiesFeedFilter: '',
    storiesFeedSortKey: 'date',
    storiesFeedSortOrder: 'desc',
    setStoriesFeed: (filter, sortKey, sortOrder) => set({ storiesFeedFilter: filter, storiesFeedSortKey: sortKey, storiesFeedSortOrder: sortOrder }),
    sidebarOpen: typeof window !== 'undefined' && window.innerWidth >= 768,
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
}));
