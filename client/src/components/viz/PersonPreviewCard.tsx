import { Focus, X } from 'lucide-react';
import { CustomAvatar } from '@/components/CustomAvatar';
import type { GraphLinkData, GraphNodeData } from '@/api/hooks';

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function lifeLine(prefix: string, year: number | null, place: string | null): string | null {
    if (!year && !place) return null;
    let line = prefix;
    if (year) line += year;
    if (place) line += year ? `, ${place}` : place;
    return line;
}

export function resolveSpouseLabel(
    personId: string,
    links: GraphLinkData[],
    nodeMap: Map<string, GraphNodeData>,
): string | null {
    const spouseLink = links.find(
        l => l.type === 'spouse' &&
            (l.source === personId || l.target === personId) &&
            l.status !== 'divorced',
    );
    if (!spouseLink) return null;
    const spouseId = spouseLink.source === personId ? spouseLink.target : spouseLink.source;
    return nodeMap.get(spouseId)?.label ?? null;
}

// ─── PersonCardBody — compact card content (shared by hover and click previews) ──

export interface PersonCardBodyProps {
    personId: string;
    label: string;
    sex: string;
    primaryAsset?: string | null;
    birthLine?: string | null;
    deathLine?: string | null;
    spouseLabel?: string | null;
    onMakeFocal?: (id: string) => void;
    onViewProfile?: (id: string) => void;
}

export function PersonCardBody({
    personId,
    label,
    sex,
    primaryAsset,
    birthLine,
    deathLine,
    spouseLabel,
    onMakeFocal,
    onViewProfile,
}: PersonCardBodyProps) {
    const showActions = !!(onMakeFocal && onViewProfile);
    return (
        <>
            <div className="flex items-start gap-2.5">
                <CustomAvatar
                    firstName={label.split(' ')[0]}
                    lastName={label.split(' ').slice(1).join(' ')}
                    photoFilename={primaryAsset ?? undefined}
                    className="h-10 w-10 flex-shrink-0 text-sm"
                    sex={sex}
                />
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{label}</p>
                    {birthLine && <p className="text-xs text-muted-foreground truncate">{birthLine}</p>}
                    {deathLine && <p className="text-xs text-muted-foreground truncate">{deathLine}</p>}
                    {spouseLabel && <p className="text-xs text-muted-foreground truncate">m. {spouseLabel}</p>}
                </div>
            </div>
            {showActions && (
                <div className="flex gap-2 mt-2.5">
                    <button
                        onClick={() => onMakeFocal!(personId)}
                        className="flex-1 flex items-center justify-center gap-1 h-7 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                        data-testid="make-focal-btn"
                    >
                        <Focus className="h-3 w-3" />
                        Focal
                    </button>
                    <button
                        onClick={() => onViewProfile!(personId)}
                        className="flex-1 h-7 rounded-md border border-border text-xs font-medium hover:bg-muted/40 transition-colors"
                    >
                        Profile
                    </button>
                </div>
            )}
        </>
    );
}

// ─── PersonPreviewCard — positioned overlay with mobile/desktop modes ──────────

export interface PersonPreviewCardProps {
    personId: string;
    label: string;
    sex: string;
    primaryAsset?: string | null;
    birthLine?: string | null;
    deathLine?: string | null;
    spouseLabel?: string | null;
    screenX: number;
    screenY: number;
    containerWidth: number;
    containerHeight: number;
    isMobile: boolean;
    onClose: () => void;
    onMakeFocal: (id: string) => void;
    onViewProfile: (id: string) => void;
}

export function PersonPreviewCard({
    personId,
    label,
    sex,
    primaryAsset,
    birthLine,
    deathLine,
    spouseLabel,
    screenX,
    screenY,
    containerWidth,
    containerHeight,
    isMobile,
    onClose,
    onMakeFocal,
    onViewProfile,
}: PersonPreviewCardProps) {
    if (isMobile) {
        return (
            <>
                <div className="absolute inset-0 z-20 bg-black/20" onClick={onClose} />
                <div
                    className="absolute bottom-0 left-0 right-0 z-30 rounded-t-2xl border-t border-border bg-card p-4 shadow-lg animate-in slide-in-from-bottom duration-200"
                    data-testid="person-preview-sheet"
                >
                    <div className="flex items-start gap-3">
                        <CustomAvatar
                            firstName={label.split(' ')[0]}
                            lastName={label.split(' ').slice(1).join(' ')}
                            photoFilename={primaryAsset ?? undefined}
                            className="h-12 w-12 flex-shrink-0 text-base"
                            sex={sex}
                        />
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{label}</p>
                            {birthLine && <p className="text-xs text-muted-foreground truncate">{birthLine}</p>}
                            {deathLine && <p className="text-xs text-muted-foreground truncate">{deathLine}</p>}
                            {spouseLabel && <p className="text-xs text-muted-foreground truncate">m. {spouseLabel}</p>}
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => onMakeFocal(personId)}
                            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                            data-testid="make-focal-btn"
                        >
                            <Focus className="h-3.5 w-3.5" />
                            Make focal person
                        </button>
                        <button
                            onClick={() => onViewProfile(personId)}
                            className="flex-1 h-9 rounded-lg border border-border text-sm font-medium hover:bg-muted/40 transition-colors"
                        >
                            View profile
                        </button>
                    </div>
                </div>
            </>
        );
    }

    // Desktop popover — positioned at cursor offset, matching hover card placement, clamped to container
    const cardHeight = 140;
    const left = Math.max(8, Math.min(screenX + 16, containerWidth - 248));
    const top = Math.max(8, Math.min(screenY + 16, containerHeight - cardHeight));

    return (
        <>
            <div className="fixed inset-0 z-20" onClick={onClose} />
            <div
                className="absolute z-30 w-60 rounded-xl border border-border bg-card shadow-lg p-3 animate-in fade-in zoom-in-95 duration-150"
                style={{ left, top }}
                data-testid="person-preview-popover"
            >
                <PersonCardBody
                    personId={personId}
                    label={label}
                    sex={sex}
                    primaryAsset={primaryAsset}
                    birthLine={birthLine}
                    deathLine={deathLine}
                    spouseLabel={spouseLabel}
                    onMakeFocal={onMakeFocal}
                    onViewProfile={onViewProfile}
                />
            </div>
        </>
    );
}
