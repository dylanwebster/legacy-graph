import { create } from 'zustand';

type StoriesSortMode = 'newest' | 'oldest' | 'alpha';

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    theme: 'dark' | 'light';
    storiesFeedFilter: string;
    storiesFeedSort: StoriesSortMode;
    toggleSidebar: () => void;
    setSearchOpen: (open: boolean) => void;
    toggleTheme: () => void;
    setStoriesFeed: (filter: string, sort: StoriesSortMode) => void;
}

export type { StoriesSortMode };

export const useUIStore = create<UIState>((set) => ({
    storiesFeedFilter: '',
    storiesFeedSort: 'newest',
    setStoriesFeed: (filter, sort) => set({ storiesFeedFilter: filter, storiesFeedSort: sort }),
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
