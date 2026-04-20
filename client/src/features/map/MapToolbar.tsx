import { useFocalStore } from '@/shared/store/focalStore';
import { useMapPrefsStore } from './prefsStore';
import type { MapScope } from './types';

export function MapToolbar() {
    const focalPersonId = useFocalStore((s) => s.focalPersonId);
    const { scope, setScope } = useMapPrefsStore();

    const hasFocal = !!focalPersonId;

    function choose(next: MapScope) {
        if ((next === 'focal' || next === 'lineage') && !hasFocal) return;
        setScope(next);
    }

    const btnClass = (active: boolean, disabled: boolean) =>
        `px-3 py-1.5 text-xs rounded-md transition-colors ${
            active ? 'bg-primary text-primary-foreground' : 'bg-background/80 text-foreground'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted'}`;

    return (
        <div className="absolute top-4 left-4 rounded-md border border-border bg-card/90 backdrop-blur-sm shadow-sm p-1 flex gap-1 max-w-[calc(100vw-2rem)] overflow-x-auto">
            <button className={btnClass(scope === 'all', false)} onClick={() => choose('all')}>
                Everyone
            </button>
            <button
                className={btnClass(scope === 'focal', !hasFocal)}
                onClick={() => choose('focal')}
                title={hasFocal ? 'Show only the focal person' : 'Set a focal person on the Graph first'}
            >
                <span className="hidden sm:inline">Focal person</span>
                <span className="sm:hidden">Focal</span>
            </button>
            <button
                className={btnClass(scope === 'lineage', !hasFocal)}
                onClick={() => choose('lineage')}
                title={hasFocal ? "Show the focal person's lineage" : 'Set a focal person on the Graph first'}
            >
                <span className="hidden sm:inline">Focal lineage</span>
                <span className="sm:hidden">Lineage</span>
            </button>
        </div>
    );
}
