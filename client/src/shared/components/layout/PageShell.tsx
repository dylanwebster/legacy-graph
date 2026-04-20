import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { TopBarActions } from './TopBarSlotContext';

interface PageShellProps {
    /** Slotted into the app topbar via TopBarActions portal. */
    topbar?: ReactNode;
    /** Rendered inline above the body — for pages that need a local nav bar (e.g. a breadcrumb row). */
    header?: ReactNode;
    /** Applied to the scrollable body region. Defaults to "flex-1 overflow-auto". */
    bodyClassName?: string;
    children: ReactNode;
    /** Modal layer — dialogs, lightboxes, etc. Rendered as siblings after the body. */
    overlays?: ReactNode;
}

/**
 * Standard page structure: optional topbar slot, optional inline header,
 * scrollable body, and an overlay layer for modals. Keeps the boilerplate
 * wrapper div + flex/overflow classes out of individual page components.
 */
export function PageShell({ topbar, header, bodyClassName, children, overlays }: PageShellProps) {
    return (
        <div className="flex flex-col h-full overflow-hidden">
            {topbar && <TopBarActions>{topbar}</TopBarActions>}
            {header}
            <div className={cn('flex-1 overflow-auto', bodyClassName)}>
                {children}
            </div>
            {overlays}
        </div>
    );
}
