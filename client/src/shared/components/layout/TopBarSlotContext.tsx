import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TopBarSlotContextValue {
    slotEl: HTMLDivElement | null;
    setSlotEl: (el: HTMLDivElement | null) => void;
}

const TopBarSlotContext = createContext<TopBarSlotContextValue>({
    slotEl: null,
    setSlotEl: () => {},
});

export function TopBarSlotProvider({ children }: { children: ReactNode }) {
    const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
    return (
        <TopBarSlotContext.Provider value={{ slotEl, setSlotEl }}>
            {children}
        </TopBarSlotContext.Provider>
    );
}

/** Returns the setter used by TopBar to register its slot div. */
export function useTopBarSlotSetter() {
    return useContext(TopBarSlotContext).setSlotEl;
}

/**
 * Renders children into the TopBar's action slot via a React portal.
 * State and event handlers remain in the calling page component.
 */
export function TopBarActions({ children }: { children: ReactNode }) {
    const { slotEl } = useContext(TopBarSlotContext);
    if (!slotEl) return null;
    return createPortal(children, slotEl);
}
