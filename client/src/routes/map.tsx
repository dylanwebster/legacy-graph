import { createFileRoute } from '@tanstack/react-router';
import type { Granularity, MapScope, Speed } from '@/features/map/types';

export interface MapSearch {
    scope?: MapScope;
    person?: string;
    t?: number;
    t_end?: number;
    g?: Granularity;
    speed?: Speed;
    play?: 0 | 1;
    loop?: 0 | 1;
    event?: string;
}

function toNumber(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
}

function toScope(v: unknown): MapScope | undefined {
    return v === 'all' || v === 'focal' || v === 'lineage' ? v : undefined;
}

function toGranularity(v: unknown): Granularity | undefined {
    return v === 'year' || v === 'decade' || v === 'century' ? v : undefined;
}

function toSpeed(v: unknown): Speed | undefined {
    const n = toNumber(v);
    return n === 0.5 || n === 1 || n === 2 || n === 4 ? (n as Speed) : undefined;
}

function toBoolNum(v: unknown): 0 | 1 | undefined {
    const n = toNumber(v);
    return n === 0 || n === 1 ? (n as 0 | 1) : undefined;
}

export const Route = createFileRoute('/map')({
    validateSearch: (raw: Record<string, unknown>): MapSearch => ({
        scope: toScope(raw.scope),
        person: typeof raw.person === 'string' ? raw.person : undefined,
        t: toNumber(raw.t),
        t_end: toNumber(raw.t_end),
        g: toGranularity(raw.g),
        speed: toSpeed(raw.speed),
        play: toBoolNum(raw.play),
        loop: toBoolNum(raw.loop),
        event: typeof raw.event === 'string' ? raw.event : undefined,
    }),
});
