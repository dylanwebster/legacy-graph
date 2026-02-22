import { create } from 'zustand';

interface UIState {
    sidebarOpen: boolean;
    searchOpen: boolean;
    toggleSidebar: () => void;
    setSearchOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    sidebarOpen: true,
    searchOpen: false,
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSearchOpen: (open) => set({ searchOpen: open }),
}));
