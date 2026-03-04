import { create } from 'zustand';

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    theme: 'dark' | 'light';
    toggleSidebar: () => void;
    setSearchOpen: (open: boolean) => void;
    toggleTheme: () => void;
}

export const useUIStore = create<UIState>((set) => ({
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
