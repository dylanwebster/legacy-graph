import type { NodeObject, LinkObject } from 'react-force-graph-2d';
import type { GraphNodeData, GraphLinkData } from '@/shared/api/hooks';

export type SimNode = NodeObject & GraphNodeData & {
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    effectiveBirthYear?: number | null;
};

export type SimLink = LinkObject & GraphLinkData;
