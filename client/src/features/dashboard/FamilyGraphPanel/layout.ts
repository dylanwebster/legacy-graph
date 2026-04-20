import type { SimNode } from './types';
import { GENERATION_GAP as GENERATION_GAP_PIXELS, CLUSTER_GAP } from './constants';

// ─── computeEffectiveBirthYears ───────────────────────────────────────────────

export function computeEffectiveBirthYears(
    nodes: Array<{ id: string; birthYear?: number | null }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
): Map<string, number> {
    const GENERATION_GAP = 28;

    const parentIds = new Map<string, string[]>();  // childId → parentIds
    const childIds = new Map<string, string[]>();  // parentId → childIds
    const spouseIds = new Map<string, string[]>(); // personId → spouseIds

    for (const n of nodes) {
        parentIds.set(n.id, []);
        childIds.set(n.id, []);
        spouseIds.set(n.id, []);
    }

    for (const l of links) {
        if (l.type === 'parent_child') {
            const childId = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
            const parentId = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
            parentIds.get(childId)?.push(parentId);
            childIds.get(parentId)?.push(childId);
        } else if (l.type === 'spouse') {
            const a = typeof l.source === 'object' ? (l.source as { id: string }).id : l.source;
            const b = typeof l.target === 'object' ? (l.target as { id: string }).id : l.target;
            spouseIds.get(a)?.push(b);
            spouseIds.get(b)?.push(a);
        }
    }

    const result = new Map<string, number>();
    for (const n of nodes) if (n.birthYear != null) result.set(n.id, n.birthYear);

    // Iteratively propagate: parent = child - GENERATION_GAP; child = parent + GENERATION_GAP; spouse matches
    let changed = true;
    while (changed) {
        changed = false;
        for (const n of nodes) {
            if (result.has(n.id)) continue;
            const estimates: number[] = [];
            for (const pid of parentIds.get(n.id) ?? []) {
                const y = result.get(pid); if (y != null) estimates.push(y + GENERATION_GAP);
            }
            for (const cid of childIds.get(n.id) ?? []) {
                const y = result.get(cid); if (y != null) estimates.push(y - GENERATION_GAP);
            }
            for (const sid of spouseIds.get(n.id) ?? []) {
                const y = result.get(sid); if (y != null) estimates.push(y);
            }
            if (estimates.length > 0) {
                result.set(n.id, estimates.reduce((a, b) => a + b, 0) / estimates.length);
                changed = true;
            }
        }
    }

    // Final fallback: dataset mean for truly isolated unknown nodes
    const knownYears = [...result.values()];
    if (knownYears.length > 0) {
        const fallback = knownYears.reduce((a, b) => a + b, 0) / knownYears.length;
        for (const n of nodes) if (!result.has(n.id)) result.set(n.id, fallback);
    }
    return result;
}

// ─── computeGenerationLevels ─────────────────────────────────────────────────
// BFS from rootId to assign Y-generation levels:
//   root=0, parents=-1, grandparents=-2, children=+1, grandchildren=+2, …
// Returns a Map<nodeId, level>; nodes not reachable from root are absent.
// Expects links already swapped by stableGraphData: source=parent, target=child.

export function computeGenerationLevels(
    nodes: Array<{ id: string }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
    rootId: string,
): Map<string, number> {
    function getId(ref: string | object): string {
        return typeof ref === 'object' ? (ref as { id: string }).id : ref;
    }
    const parentIds = new Map<string, string[]>();  // childId → parentIds
    const childIds = new Map<string, string[]>();  // parentId → childIds
    for (const n of nodes) { parentIds.set(n.id, []); childIds.set(n.id, []); }
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        const parentId = getId(l.source); // source = parent (post-swap in stableGraphData)
        const childId = getId(l.target);  // target = child
        parentIds.get(childId)?.push(parentId);
        childIds.get(parentId)?.push(childId);
    }

    const levels = new Map<string, number>();

    // Ancestors: only traverse upwards
    let queue: Array<{ id: string; level: number }> = [{ id: rootId, level: 0 }];
    levels.set(rootId, 0);
    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        for (const pid of parentIds.get(id) ?? []) {
            if (!levels.has(pid)) {
                levels.set(pid, level - 1);
                queue.push({ id: pid, level: level - 1 });
            }
        }
    }

    // Descendants: only traverse downwards
    queue = [{ id: rootId, level: 0 }];
    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        for (const cid of childIds.get(id) ?? []) {
            if (!levels.has(cid)) {
                levels.set(cid, level + 1);
                queue.push({ id: cid, level: level + 1 });
            }
        }
    }

    return levels;
}

// ─── Topological Y Pre-Sorter ─────────────────────────────────────────────────
// Deterministic initial Y placement that minimizes edge crossings before the
// physics simulation starts. Sorts siblings by birth year, keeps spouses
// adjacent, and gives disjoint family clusters non-overlapping Y bands.

export function computeFamilyClusterY(
    nodes: Array<{ id: string; effectiveBirthYear?: number | null }>,
    links: Array<{ source: string | object; target: string | object; type: string }>,
): Map<string, number> {
    function getId(ref: string | object): string {
        return typeof ref === 'object' ? (ref as { id: string }).id : ref;
    }

    const nodeMap = new Map<string, { id: string; effectiveBirthYear?: number | null }>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Build adjacency maps
    const parentIds = new Map<string, string[]>();
    const childIds = new Map<string, string[]>();
    const spouseIds = new Map<string, string[]>();
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) {
        parentIds.set(n.id, []);
        childIds.set(n.id, []);
        spouseIds.set(n.id, []);
        adj.set(n.id, new Set());
    }
    for (const l of links) {
        if (l.type === 'parent_child') {
            const cId = getId(l.target); // target is child (already swapped in stableGraphData)
            const pId = getId(l.source); // source is parent
            parentIds.get(cId)?.push(pId);
            childIds.get(pId)?.push(cId);
            adj.get(cId)?.add(pId);
            adj.get(pId)?.add(cId);
        } else if (l.type === 'spouse') {
            const a = getId(l.source);
            const b = getId(l.target);
            spouseIds.get(a)?.push(b);
            spouseIds.get(b)?.push(a);
            adj.get(a)?.add(b);
            adj.get(b)?.add(a);
        }
    }

    // Find connected components
    const visited = new Set<string>();
    const components: string[][] = [];
    for (const n of nodes) {
        if (visited.has(n.id)) continue;
        const comp: string[] = [];
        const stack = [n.id];
        while (stack.length > 0) {
            const cur = stack.pop()!;
            if (visited.has(cur)) continue;
            visited.add(cur);
            comp.push(cur);
            for (const nb of adj.get(cur) ?? []) {
                if (!visited.has(nb)) stack.push(nb);
            }
        }
        components.push(comp);
    }

    // Sort components by size descending so the largest family is centered
    components.sort((a, b) => b.length - a.length);

    const result = new Map<string, number>();
    let clusterOffset = 0;

    for (const comp of components) {
        // Topological sort within each component:
        // Start from roots (no parents), BFS downward, sorting siblings by birth year
        const roots = comp.filter(id => (parentIds.get(id) ?? []).length === 0);
        const starts = roots.length > 0 ? roots : [comp[0]];

        // Sort starting roots by birth year
        starts.sort((a, b) => {
            const ya = nodeMap.get(a)?.effectiveBirthYear ?? 9999;
            const yb = nodeMap.get(b)?.effectiveBirthYear ?? 9999;
            return ya - yb;
        });

        const placed = new Map<string, number>(); // id → local Y slot
        let nextSlot = 0;

        // Place a node and its spouse(s) at the current slot
        const placeNodeWithSpouse = (id: string) => {
            if (placed.has(id)) return;
            placed.set(id, nextSlot);

            // Place spouses at the same slot
            for (const sid of spouseIds.get(id) ?? []) {
                if (!placed.has(sid)) {
                    placed.set(sid, nextSlot);
                }
            }
            nextSlot++;
        };

        // BFS: process parents first, then children sorted by birth year
        const queue = [...starts];
        for (const s of starts) placeNodeWithSpouse(s);

        while (queue.length > 0) {
            const id = queue.shift()!;

            // Get children, sort by birth year (older → higher/earlier slot)
            const children = (childIds.get(id) ?? []).filter(cid => !placed.has(cid));
            children.sort((a, b) => {
                const ya = nodeMap.get(a)?.effectiveBirthYear ?? 9999;
                const yb = nodeMap.get(b)?.effectiveBirthYear ?? 9999;
                return ya - yb;
            });

            for (const cid of children) {
                placeNodeWithSpouse(cid);
                queue.push(cid);
            }
        }

        // Catch any unvisited nodes in this component
        for (const id of comp) {
            if (!placed.has(id)) placeNodeWithSpouse(id);
        }

        // Convert slots to pixel positions
        for (const [id, slot] of placed) {
            result.set(id, clusterOffset + slot * GENERATION_GAP_PIXELS);
        }

        clusterOffset += nextSlot * GENERATION_GAP_PIXELS + CLUSTER_GAP;
    }

    // Center everything around Y=0
    const allY = [...result.values()];
    if (allY.length > 0) {
        const centerY = (Math.min(...allY) + Math.max(...allY)) / 2;
        for (const [id, y] of result) {
            result.set(id, y - centerY);
        }
    }

    return result;
}

// ─── Centering Y Force ────────────────────────────────────────────────────────
// Provides a very weak global centering force to keep the graph from drifting
// too far from the Y=0 axis, without distorting the family structure.

export function makeCenteringYForce() {
    let nodes: SimNode[] = [];
    function force(alpha: number) {
        for (const node of nodes) {
            if (node.vy === undefined || node.y === undefined) continue;
            // Weak global centering
            node.vy += (0 - node.y) * 0.02 * alpha;
        }
    }
    (force as unknown as { initialize: (n: SimNode[]) => void }).initialize = (n: SimNode[]) => { nodes = n; };
    return force;
}
