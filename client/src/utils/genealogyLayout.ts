/**
 * Pure TypeScript layout utilities for genealogy visualizations.
 * No DOM, React, or browser dependencies — fully unit-testable.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AncestorSlot {
    /** null = unknown / missing ancestor */
    id: string | null;
    label: string;
    sex: string;
    /** 0 = root, 1 = parents, 2 = grandparents, … */
    generation: number;
    /**
     * 0-indexed position within the generation, following Ahnentafel numbering:
     *   gen 1, slot 0 = father, slot 1 = mother
     *   gen 2, slot 0 = pat. grandfather, 1 = pat. grandmother,
     *           slot 2 = mat. grandfather, 3 = mat. grandmother
     *   etc.
     */
    slotIndex: number;
}

export interface FanArc {
    slot: AncestorSlot;
    startAngle: number; // radians, 0=right, clockwise (SVG convention)
    endAngle: number;
    innerR: number;
    outerR: number;
}

export interface PedigreeNode {
    slot: AncestorSlot;
    x: number;
    y: number;
}

export interface PedigreeConnector {
    id: string;
    x1: number;
    y1: number;
    /** Elbow midpoint x (horizontal layout) or y (vertical layout) */
    mx: number;
    my: number;
    x2: number;
    y2: number;
}

// ─── Input types (minimal — avoids coupling to API types) ─────────────────────

interface NodeRef {
    id: string;
    label: string;
    sex: string;
}

interface LinkRef {
    source: string;
    target: string;
    type: string;
}

// ─── buildAncestorTree ────────────────────────────────────────────────────────

/**
 * BFS upward from rootId through parent_child links to build an ancestor tree.
 * Returns one AncestorSlot per slot (including null slots for missing ancestors).
 * Always includes the root node at generation 0.
 *
 * parent_child edges: source = child, target = parent (API convention).
 */
export function buildAncestorTree(
    nodes: NodeRef[],
    links: LinkRef[],
    rootId: string,
    maxGenerations: number,
): AncestorSlot[] {
    const nodeMap = new Map<string, NodeRef>(nodes.map((n) => [n.id, n]));

    // Build parent lookup: childId → [parentId, ...]  (sorted deterministically)
    const parentMap = new Map<string, string[]>();
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        // source = child, target = parent (API convention)
        const childId = l.source;
        const parentId = l.target;
        if (!parentMap.has(childId)) parentMap.set(childId, []);
        parentMap.get(childId)!.push(parentId);
    }
    // Sort parents: M (father) first, F (mother) second, then by ID for stability.
    // This ensures Ahnentafel convention: even slots = father, odd slots = mother.
    const sexOrder = (id: string) => {
        const sex = nodeMap.get(id)?.sex;
        if (sex === 'M') return 0;
        if (sex === 'F') return 1;
        return 2;
    };
    for (const [, parents] of parentMap) {
        parents.sort((a, b) => sexOrder(a) - sexOrder(b) || a.localeCompare(b));
    }

    const result: AncestorSlot[] = [];

    // Slot layout: generation g has 2^g slots (0..2^g-1).
    // Slot p in gen g has parents at slots 2p (father) and 2p+1 (mother) in gen g+1.
    // We do BFS by slot, not by person ID.

    interface SlotEntry {
        personId: string | null;
        generation: number;
        slotIndex: number;
    }

    const queue: SlotEntry[] = [{ personId: rootId, generation: 0, slotIndex: 0 }];

    while (queue.length > 0) {
        const { personId, generation, slotIndex } = queue.shift()!;

        const node = personId ? nodeMap.get(personId) : null;
        result.push({
            id: personId,
            label: node?.label ?? '',
            sex: node?.sex ?? 'U',
            generation,
            slotIndex,
        });

        if (generation >= maxGenerations) continue;

        const parents = personId ? (parentMap.get(personId) ?? []) : [];
        // Father = first parent (slot 0 relative to this person), Mother = second
        const fatherId = parents[0] ?? null;
        const motherId = parents[1] ?? null;

        queue.push({ personId: fatherId, generation: generation + 1, slotIndex: slotIndex * 2 });
        queue.push({ personId: motherId, generation: generation + 1, slotIndex: slotIndex * 2 + 1 });
    }

    return result;
}

// ─── computeFanArcLayout ──────────────────────────────────────────────────────

/** Fan start angle: 135° (lower-left in SVG y-down). Shared with hit-test in FanChartPanel. */
export const FAN_START_ANGLE = 0.75 * Math.PI;

/**
 * Map an atan2 result ([-π, π]) into the fan chart's arc coordinate space
 * ([FAN_START_ANGLE, FAN_START_ANGLE + 2π)).
 */
export function normalizeFanAngle(raw: number): number {
    return raw < FAN_START_ANGLE ? raw + 2 * Math.PI : raw;
}

/**
 * Compute FanArc descriptors for all ancestor slots (excluding generation 0 root).
 * Fan is a 270° arc: root at center, ancestors radiate outward.
 * Gap at the bottom (45°–135° in SVG y-down coords).
 * Paternal ancestors trail up-left (135°→270°), maternal up-right (270°→405°=45°).
 *
 * @param slots  result of buildAncestorTree
 * @param containerSize  min(width, height) of the SVG container (used to auto-size rings)
 */
export function computeFanArcLayout(
    slots: AncestorSlot[],
    containerSize: number,
    BASE_R = 50,
): FanArc[] {
    const maxGen = Math.max(0, ...slots.map((s) => s.generation));
    if (maxGen === 0) return [];

    // Inner rings (gen 1–3): consistent fixed width, scaled gently to container.
    // Outer rings (gen 4+): double the inner width so labels have room along the radial axis.
    // Rings always expand outward — adding generations never shrinks existing rings.
    const INNER_RING_WIDTH = Math.min(90, Math.max(55, containerSize * 0.115));
    const OUTER_RING_WIDTH = INNER_RING_WIDTH * 2;
    const TOTAL_ANGLE = 1.5 * Math.PI; // 270°

    const result: FanArc[] = [];

    for (const slot of slots) {
        if (slot.generation === 0) continue;

        const g = slot.generation;
        const slotsInGen = Math.pow(2, g);
        const slotWidth = TOTAL_ANGLE / slotsInGen;

        const startAngle = FAN_START_ANGLE + slot.slotIndex * slotWidth;
        const endAngle = startAngle + slotWidth;

        // Gen 1–3: uniform inner ring width.
        // Gen 4+: transition to doubled outer ring width.
        let innerR: number;
        let outerR: number;
        if (g <= 3) {
            innerR = BASE_R + (g - 1) * INNER_RING_WIDTH;
            outerR = BASE_R + g * INNER_RING_WIDTH;
        } else {
            const innerBase = BASE_R + 3 * INNER_RING_WIDTH;
            innerR = innerBase + (g - 4) * OUTER_RING_WIDTH;
            outerR = innerBase + (g - 3) * OUTER_RING_WIDTH;
        }

        result.push({ slot, startAngle, endAngle, innerR, outerR });
    }

    return result;
}

// ─── computePedigreeLayout ────────────────────────────────────────────────────

export const PEDIGREE_CARD_W = 160;
export const PEDIGREE_CARD_H = 56;
const H_GAP = 56; // horizontal gap between generations (horizontal layout)
const V_GAP = 12; // vertical gap between slots

/**
 * Compute x/y positions for each ancestor slot.
 * Horizontal layout: root at x=0, ancestors branch rightward; y centered.
 * Vertical layout:   root at y=0, ancestors branch upward; x centered.
 *
 * Coordinates are relative to the root card (top-left corner).
 * The caller must translate by (rootX, rootY) = (0, 0) and apply pan/zoom.
 */
export function computePedigreeLayout(
    slots: AncestorSlot[],
    orientation: 'horizontal' | 'vertical',
): PedigreeNode[] {
    const maxGen = Math.max(0, ...slots.map((s) => s.generation));

    // Total number of slots in the largest generation
    const maxSlots = Math.pow(2, maxGen);

    // Total size of the largest generation band
    const totalVertical = maxSlots * (PEDIGREE_CARD_H + V_GAP) - V_GAP;
    const totalHorizontal = maxSlots * (PEDIGREE_CARD_W + H_GAP) - H_GAP;

    return slots.map((slot): PedigreeNode => {
        const g = slot.generation;
        const slotsInGen = Math.pow(2, g);
        // band size for this generation
        const bandV = maxSlots / slotsInGen * (PEDIGREE_CARD_H + V_GAP);
        const bandH = maxSlots / slotsInGen * (PEDIGREE_CARD_W + H_GAP);

        let x: number;
        let y: number;

        if (orientation === 'horizontal') {
            x = g * (PEDIGREE_CARD_W + H_GAP);
            // Centre within band, then offset from midpoint of full column
            y = slot.slotIndex * bandV + (bandV - PEDIGREE_CARD_H) / 2 - totalVertical / 2;
        } else {
            // Vertical: root at bottom, ancestors upward
            y = -g * (PEDIGREE_CARD_H + V_GAP * 3);
            x = slot.slotIndex * bandH + (bandH - PEDIGREE_CARD_W) / 2 - totalHorizontal / 2;
        }

        return { slot, x, y };
    });
}

// ─── computePedigreeConnectors ────────────────────────────────────────────────

/**
 * Compute connector line segments (with elbow) between each parent and child card.
 * In horizontal layout: elbow is a vertical line halfway between columns.
 * In vertical layout: elbow is a horizontal line halfway between rows.
 */
export function computePedigreeConnectors(
    nodes: PedigreeNode[],
    orientation: 'horizontal' | 'vertical',
): PedigreeConnector[] {
    // Build index: (generation, slotIndex) → PedigreeNode
    const nodeMap = new Map<string, PedigreeNode>();
    for (const n of nodes) {
        nodeMap.set(`${n.slot.generation}:${n.slot.slotIndex}`, n);
    }

    const result: PedigreeConnector[] = [];

    for (const child of nodes) {
        if (child.slot.generation === 0) continue;
        // Parent is at (generation - 1, floor(slotIndex / 2))
        const parentSlot = Math.floor(child.slot.slotIndex / 2);
        const parent = nodeMap.get(`${child.slot.generation - 1}:${parentSlot}`);
        if (!parent) continue;
        if (!parent.slot.id && !child.slot.id) continue; // skip fully empty

        const id = `${child.slot.generation}-${child.slot.slotIndex}`;

        if (orientation === 'horizontal') {
            // Parent right-center → child left-center via elbow at midpoint x
            const px = parent.x + PEDIGREE_CARD_W;
            const py = parent.y + PEDIGREE_CARD_H / 2;
            const cx = child.x;
            const cy = child.y + PEDIGREE_CARD_H / 2;
            const mx = (px + cx) / 2;
            result.push({ id, x1: px, y1: py, mx, my: py, x2: cx, y2: cy });
        } else {
            // Parent bottom-center → child top-center via elbow at midpoint y
            const px = parent.x + PEDIGREE_CARD_W / 2;
            const py = parent.y; // top of parent card (ancestors are above in vertical)
            const cx = child.x + PEDIGREE_CARD_W / 2;
            const cy = child.y + PEDIGREE_CARD_H; // bottom of child card
            const my = (py + cy) / 2;
            result.push({ id, x1: px, y1: py, mx: px, my, x2: cx, y2: cy });
        }
    }

    return result;
}

// ─── FamilyTreeNode (bidirectional tree) ─────────────────────────────────────

export interface FamilyTreeNode {
    id: string | null;
    label: string;
    sex: string;
    birthYear: number | null;
    /** negative = ancestor, 0 = root, positive = descendant */
    generation: number;
    parents: FamilyTreeNode[];
    children: FamilyTreeNode[];
    siblings: FamilyTreeNode[];
    hasHiddenAncestors: boolean;
    hasHiddenDescendants: boolean;
    hasHiddenSiblings: boolean;
    /** true = root or direct ancestor/descendant path; false = sibling node */
    isLineage: boolean;
}

/**
 * Build a bidirectional family tree from root, traversing both ancestors (upward)
 * and descendants (downward) with configurable depth limits and per-node expansion.
 *
 * parent_child edges: source = child, target = parent (API convention).
 */
export function buildFamilyTree(
    nodes: NodeRef[],
    links: LinkRef[],
    rootId: string,
    ancestorDepth: number,
    descendantDepth: number,
    expandedAncestors: Set<string>,
    expandedDescendants: Set<string>,
    expandedSiblings: Set<string>,
): FamilyTreeNode {
    const nodeMap = new Map<string, NodeRef>(nodes.map((n) => [n.id, n]));

    // Build lookup maps
    const parentMap = new Map<string, string[]>(); // childId → parentIds
    const childMap = new Map<string, string[]>();  // parentId → childIds
    for (const l of links) {
        if (l.type !== 'parent_child') continue;
        const childId = l.source;
        const parentId = l.target;
        if (!parentMap.has(childId)) parentMap.set(childId, []);
        parentMap.get(childId)!.push(parentId);
        if (!childMap.has(parentId)) childMap.set(parentId, []);
        childMap.get(parentId)!.push(childId);
    }
    // Sort parents: M (father) first, F (mother) second, then by ID for stability.
    const sexOrder = (id: string) => {
        const sex = nodeMap.get(id)?.sex;
        if (sex === 'M') return 0;
        if (sex === 'F') return 1;
        return 2;
    };
    for (const [, ids] of parentMap) {
        ids.sort((a, b) => sexOrder(a) - sexOrder(b) || a.localeCompare(b));
    }
    for (const [, ids] of childMap) ids.sort();

    // Compute siblings: people who share at least one parent
    function getSiblings(personId: string): string[] {
        const parents = parentMap.get(personId) ?? [];
        const sibs = new Set<string>();
        for (const pid of parents) {
            for (const cid of childMap.get(pid) ?? []) {
                if (cid !== personId) sibs.add(cid);
            }
        }
        return [...sibs].sort();
    }

    const visited = new Set<string>();

    function buildUp(personId: string, generation: number, depthRemaining: number): FamilyTreeNode {
        const node = nodeMap.get(personId);
        const allParents = parentMap.get(personId) ?? [];
        const allSiblings = getSiblings(personId);

        const effectiveDepth = expandedAncestors.has(personId) ? Math.max(depthRemaining, 1) : depthRemaining;

        visited.add(personId);

        const parents: FamilyTreeNode[] = [];
        if (effectiveDepth > 0) {
            for (const pid of allParents) {
                if (!visited.has(pid)) {
                    parents.push(buildUp(pid, generation - 1, effectiveDepth - 1));
                }
            }
        }

        const siblings: FamilyTreeNode[] = [];
        if (expandedSiblings.has(personId)) {
            for (const sid of allSiblings) {
                if (!visited.has(sid)) {
                    visited.add(sid);
                    const sibNode = nodeMap.get(sid);
                    siblings.push({
                        id: sid,
                        label: sibNode?.label ?? '',
                        sex: sibNode?.sex ?? 'U',
                        birthYear: null,
                        generation,
                        parents: [],
                        children: [],
                        siblings: [],
                        hasHiddenAncestors: false,
                        hasHiddenDescendants: false,
                        hasHiddenSiblings: false,
                        isLineage: false,
                    });
                }
            }
        }

        const hasHiddenAncestors = allParents.length > 0 && parents.length === 0;
        const hasHiddenDescendants = false; // ancestor-side nodes don't support descendant expansion
        const hasHiddenSiblings = allSiblings.length > 0 && siblings.length === 0;

        return {
            id: personId,
            label: node?.label ?? '',
            sex: node?.sex ?? 'U',
            birthYear: null,
            generation,
            parents,
            children: [],
            siblings,
            hasHiddenAncestors,
            hasHiddenDescendants,
            hasHiddenSiblings,
            isLineage: true,
        };
    }

    function buildDown(personId: string, generation: number, depthRemaining: number): FamilyTreeNode {
        const node = nodeMap.get(personId);
        const allChildren = childMap.get(personId) ?? [];
        const allSiblings = getSiblings(personId);

        const effectiveDepth = expandedDescendants.has(personId) ? Math.max(depthRemaining, 1) : depthRemaining;

        visited.add(personId);

        const children: FamilyTreeNode[] = [];
        if (effectiveDepth > 0) {
            for (const cid of allChildren) {
                if (!visited.has(cid)) {
                    children.push(buildDown(cid, generation + 1, effectiveDepth - 1));
                }
            }
        }

        const siblings: FamilyTreeNode[] = [];
        if (expandedSiblings.has(personId)) {
            for (const sid of allSiblings) {
                if (!visited.has(sid)) {
                    visited.add(sid);
                    const sibNode = nodeMap.get(sid);
                    siblings.push({
                        id: sid,
                        label: sibNode?.label ?? '',
                        sex: sibNode?.sex ?? 'U',
                        birthYear: null,
                        generation,
                        parents: [],
                        children: [],
                        siblings: [],
                        hasHiddenAncestors: false,
                        hasHiddenDescendants: false,
                        hasHiddenSiblings: false,
                        isLineage: false,
                    });
                }
            }
        }

        const hasHiddenAncestors = false; // descendant-side nodes don't support ancestor expansion
        const hasHiddenDescendants = allChildren.length > 0 && children.length === 0;
        const hasHiddenSiblings = allSiblings.length > 0 && siblings.length === 0;

        return {
            id: personId,
            label: node?.label ?? '',
            sex: node?.sex ?? 'U',
            birthYear: null,
            generation,
            parents: [],
            children,
            siblings,
            hasHiddenAncestors,
            hasHiddenDescendants,
            hasHiddenSiblings,
            isLineage: true,
        };
    }

    // Build ancestor subtree
    visited.clear();
    const ancestorTree = buildUp(rootId, 0, ancestorDepth);

    // Build descendant subtree
    visited.clear();
    visited.add(rootId);
    const descendantChildren: FamilyTreeNode[] = [];
    const allChildren = childMap.get(rootId) ?? [];
    const effDescDepth = expandedDescendants.has(rootId) ? Math.max(descendantDepth, 1) : descendantDepth;
    if (effDescDepth > 0) {
        for (const cid of allChildren) {
            if (!visited.has(cid)) {
                descendantChildren.push(buildDown(cid, 1, effDescDepth - 1));
            }
        }
    }

    // Combine: root with ancestors as parents, descendants as children
    const allSiblings = getSiblings(rootId);
    const rootSiblings: FamilyTreeNode[] = [];
    if (expandedSiblings.has(rootId)) {
        for (const sid of allSiblings) {
            if (!visited.has(sid)) {
                visited.add(sid);
                const sibNode = nodeMap.get(sid);
                rootSiblings.push({
                    id: sid,
                    label: sibNode?.label ?? '',
                    sex: sibNode?.sex ?? 'U',
                    birthYear: null,
                    generation: 0,
                    parents: [],
                    children: [],
                    siblings: [],
                    hasHiddenAncestors: (parentMap.get(sid) ?? []).length > 0,
                    hasHiddenDescendants: (childMap.get(sid) ?? []).length > 0,
                    hasHiddenSiblings: false,
                    isLineage: false,
                });
            }
        }
    }

    return {
        ...ancestorTree,
        children: descendantChildren,
        siblings: ancestorTree.siblings.length > 0 ? ancestorTree.siblings : rootSiblings,
        hasHiddenDescendants: allChildren.length > 0 && descendantChildren.length === 0,
        hasHiddenSiblings: allSiblings.length > 0 && rootSiblings.length === 0 && ancestorTree.siblings.length === 0,
    };
}

// ─── Adaptive Tree Layout ────────────────────────────────────────────────────

export interface PositionedTreeNode {
    node: FamilyTreeNode;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TreeConnector {
    id: string;
    path: string; // SVG path "d" attribute
    kind: 'parent-child' | 'sibling';
    isLineage: boolean; // true = both endpoints are on the direct ancestor/descendant path
}

const BASE_CARD_W = 192;
const BASE_CARD_H = 64;
const TREE_GEN_GAP = 56;
const TREE_NODE_GAP = 12;
/** Extra gap appended after a node's sibling group to visually separate branches. */
const SIBLING_GROUP_EXTRA_GAP = 20;

/**
 * Compute positions for all nodes in a bidirectional family tree.
 * Uses a simplified tidy-tree algorithm that adapts spacing to actual subtree sizes.
 *
 * Horizontal: descendants LEFT, root center, ancestors RIGHT.
 * Vertical: descendants BELOW, root center, ancestors ABOVE.
 * Root is at (0, 0). Caller applies pan/zoom transform.
 */
export function computeAdaptiveTreeLayout(
    root: FamilyTreeNode,
    orientation: 'horizontal' | 'vertical',
    cardW = BASE_CARD_W,
    cardH = BASE_CARD_H,
): { nodes: PositionedTreeNode[]; connectors: TreeConnector[] } {
    // In horizontal mode the branching axis is x and the stacking axis is y.
    // In vertical mode, emit() swaps and negates: screen_x = logical_y, screen_y = -logical_x.
    // The stacking dimension (cross axis) must therefore be cardW (192px) in vertical, not cardH (64px).
    const mainAxisCardSize = orientation === 'horizontal' ? cardW : cardH;   // card extent along branching direction
    const crossAxisCardSize = orientation === 'horizontal' ? cardH : cardW;  // card extent along stacking direction
    const positioned: PositionedTreeNode[] = [];
    const connectors: TreeConnector[] = [];
    const added = new Set<FamilyTreeNode>();

    /** Cross-axis extent of a node including its siblings stacked alongside */
    function nodeWithSiblingsH(node: FamilyTreeNode): number {
        return crossAxisCardSize + node.siblings.length * (crossAxisCardSize + TREE_NODE_GAP);
    }

    function ancestorSubtreeHeight(node: FamilyTreeNode): number {
        const selfH = nodeWithSiblingsH(node);
        if (node.parents.length === 0) return selfH;
        let total = 0;
        for (let i = 0; i < node.parents.length; i++) {
            if (i > 0) total += TREE_NODE_GAP;
            total += ancestorSubtreeHeight(node.parents[i]);
        }
        // When parents push the node down via centering (myCY ≤ yStart + total/2),
        // siblings extend below. The worst-case bottom is total/2 + cardH/2 + siblingsH.
        const siblingsH = node.siblings.length * (crossAxisCardSize + TREE_NODE_GAP);
        const extraGap = node.siblings.length > 0 ? SIBLING_GROUP_EXTRA_GAP : 0;
        return Math.max(selfH, total, total / 2 + crossAxisCardSize / 2 + siblingsH) + extraGap;
    }

    function descendantSubtreeHeight(node: FamilyTreeNode): number {
        const selfH = nodeWithSiblingsH(node);
        if (node.children.length === 0) return selfH;
        let total = 0;
        for (let i = 0; i < node.children.length; i++) {
            if (i > 0) total += TREE_NODE_GAP;
            total += descendantSubtreeHeight(node.children[i]);
        }
        // Same centering logic as ancestor side.
        const siblingsH = node.siblings.length * (crossAxisCardSize + TREE_NODE_GAP);
        const extraGap = node.siblings.length > 0 ? SIBLING_GROUP_EXTRA_GAP : 0;
        return Math.max(selfH, total, total / 2 + crossAxisCardSize / 2 + siblingsH) + extraGap;
    }

    function emit(node: FamilyTreeNode, x: number, y: number) {
        if (added.has(node)) return;
        added.add(node);
        if (orientation === 'horizontal') {
            positioned.push({ node, x, y, width: cardW, height: cardH });
        } else {
            // Swap axes and negate x: screen_x = logical_y, screen_y = -logical_x
            // This maps logical "rightward" ancestors → screen "upward" (negative y)
            positioned.push({ node, x: y, y: -x, width: cardW, height: cardH });
        }
    }

    function emitConnector(
        fromX: number, fromCY: number,
        toX: number, toCY: number,
        dir: 'ancestor' | 'descendant',
        fromNode: FamilyTreeNode,
        toNode: FamilyTreeNode,
        isLineage: boolean,
    ) {
        const fid = fromNode.id ?? `g${fromNode.generation}`;
        const tid = toNode.id ?? `g${toNode.generation}`;
        const id = `${fid}-${tid}-${dir}`;

        if (orientation === 'horizontal') {
            // Ancestors are RIGHT, descendants are LEFT
            const x1 = dir === 'ancestor' ? fromX + mainAxisCardSize : fromX;
            const x2 = dir === 'ancestor' ? toX : toX + mainAxisCardSize;
            const mx = (x1 + x2) / 2;
            connectors.push({ id, kind: 'parent-child', isLineage, path: `M ${x1} ${fromCY} L ${mx} ${fromCY} L ${mx} ${toCY} L ${x2} ${toCY}` });
        } else {
            // After swap+negate: screen_x = logical_y (fromCY/toCY), screen_y = -logical_x
            // Ancestors are ABOVE (negative screen y), descendants BELOW (positive screen y)
            // Card top edge in screen_y = -genX; card bottom = -genX + cardH
            const y1 = dir === 'ancestor' ? -fromX : -fromX + cardH;
            const y2 = dir === 'ancestor' ? -toX + cardH : -toX;
            const my = (y1 + y2) / 2;
            connectors.push({ id, kind: 'parent-child', isLineage, path: `M ${fromCY} ${y1} L ${fromCY} ${my} L ${toCY} ${my} L ${toCY} ${y2}` });
        }
    }

    function layoutAncestors(node: FamilyTreeNode, genX: number, yStart: number): number {
        if (node.parents.length === 0) {
            const cy = yStart + crossAxisCardSize / 2;
            emit(node, genX, yStart);
            // Place siblings below; no visible parents to connect from
            let sibY = yStart + crossAxisCardSize + TREE_NODE_GAP;
            for (const sib of node.siblings) {
                emit(sib, genX, sibY);
                sibY += crossAxisCardSize + TREE_NODE_GAP;
            }
            return cy;
        }
        // Ancestors branch in the positive main-axis direction
        const parentGenX = genX + (mainAxisCardSize + TREE_GEN_GAP);
        let currentY = yStart;
        const parentCenters: number[] = [];
        for (let i = 0; i < node.parents.length; i++) {
            if (i > 0) currentY += TREE_NODE_GAP;
            const h = ancestorSubtreeHeight(node.parents[i]);
            const cy = layoutAncestors(node.parents[i], parentGenX, currentY);
            parentCenters.push(cy);
            currentY += h;
        }
        const myCY = (Math.min(...parentCenters) + Math.max(...parentCenters)) / 2;
        const nodeY = myCY - crossAxisCardSize / 2;
        emit(node, genX, nodeY);
        // Focal node → each parent (lineage connectors)
        for (let i = 0; i < node.parents.length; i++) {
            emitConnector(genX, myCY, parentGenX, parentCenters[i], 'ancestor',
                node, node.parents[i], node.isLineage && node.parents[i].isLineage);
        }
        // Siblings: place below focal node, connect each to the same parent(s)
        let sibY = nodeY + crossAxisCardSize + TREE_NODE_GAP;
        for (const sib of node.siblings) {
            emit(sib, genX, sibY);
            const sibCY = sibY + crossAxisCardSize / 2;
            for (let i = 0; i < node.parents.length; i++) {
                emitConnector(genX, sibCY, parentGenX, parentCenters[i], 'ancestor',
                    sib, node.parents[i], false);
            }
            sibY += crossAxisCardSize + TREE_NODE_GAP;
        }
        return myCY;
    }

    function layoutDescendants(node: FamilyTreeNode, genX: number, yStart: number): number {
        if (node.children.length === 0) {
            const cy = yStart + crossAxisCardSize / 2;
            emit(node, genX, yStart);
            // Place siblings below; no child info to connect from (descendants have no parent data)
            let sibY = yStart + crossAxisCardSize + TREE_NODE_GAP;
            for (const sib of node.siblings) {
                emit(sib, genX, sibY);
                sibY += crossAxisCardSize + TREE_NODE_GAP;
            }
            return cy;
        }
        // Descendants branch in the negative main-axis direction
        const childGenX = genX - (mainAxisCardSize + TREE_GEN_GAP);
        let currentY = yStart;
        const childCenters: number[] = [];
        for (let i = 0; i < node.children.length; i++) {
            if (i > 0) currentY += TREE_NODE_GAP;
            const h = descendantSubtreeHeight(node.children[i]);
            const cy = layoutDescendants(node.children[i], childGenX, currentY);
            childCenters.push(cy);
            currentY += h;
        }
        const myCY = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
        const nodeY = myCY - crossAxisCardSize / 2;
        emit(node, genX, nodeY);
        for (let i = 0; i < node.children.length; i++) {
            emitConnector(genX, myCY, childGenX, childCenters[i], 'descendant',
                node, node.children[i], node.isLineage && node.children[i].isLineage);
        }
        // Siblings on descendant side have no parent info — place without connectors
        let sibY = nodeY + crossAxisCardSize + TREE_NODE_GAP;
        for (const sib of node.siblings) {
            emit(sib, genX, sibY);
            sibY += crossAxisCardSize + TREE_NODE_GAP;
        }
        return myCY;
    }

    // Layout ancestor side (positive main-axis from root)
    const ancestorH = root.parents.length > 0 ? ancestorSubtreeHeight(root) : crossAxisCardSize;
    const descH = root.children.length > 0 ? descendantSubtreeHeight(root) : crossAxisCardSize;

    if (root.parents.length > 0) {
        const aStart = -ancestorH / 2;
        const parentGenX = mainAxisCardSize + TREE_GEN_GAP;
        let currentY = aStart;
        const parentCenters: number[] = [];
        for (let i = 0; i < root.parents.length; i++) {
            if (i > 0) currentY += TREE_NODE_GAP;
            const h = ancestorSubtreeHeight(root.parents[i]);
            const cy = layoutAncestors(root.parents[i], parentGenX, currentY);
            parentCenters.push(cy);
            currentY += h;
        }
        // Root → each parent (always lineage)
        for (let i = 0; i < root.parents.length; i++) {
            emitConnector(0, 0, parentGenX, parentCenters[i], 'ancestor', root, root.parents[i], true);
        }
        // Root siblings → same parents (non-lineage); placed below root
        let sibY = (-crossAxisCardSize / 2) + crossAxisCardSize + TREE_NODE_GAP;
        for (const sib of root.siblings) {
            emit(sib, 0, sibY);
            const sibCY = sibY + crossAxisCardSize / 2;
            for (let i = 0; i < root.parents.length; i++) {
                emitConnector(0, sibCY, parentGenX, parentCenters[i], 'ancestor', sib, root.parents[i], false);
            }
            sibY += crossAxisCardSize + TREE_NODE_GAP;
        }
    } else {
        // No parents: emit root siblings without connectors
        let sibY = (-crossAxisCardSize / 2) + crossAxisCardSize + TREE_NODE_GAP;
        for (const sib of root.siblings) {
            emit(sib, 0, sibY);
            sibY += crossAxisCardSize + TREE_NODE_GAP;
        }
    }

    // Layout descendant side (negative main-axis from root)
    if (root.children.length > 0) {
        const dStart = -descH / 2;
        const childGenX = -(mainAxisCardSize + TREE_GEN_GAP);
        let currentY = dStart;
        const childCenters: number[] = [];
        for (let i = 0; i < root.children.length; i++) {
            if (i > 0) currentY += TREE_NODE_GAP;
            const h = descendantSubtreeHeight(root.children[i]);
            const cy = layoutDescendants(root.children[i], childGenX, currentY);
            childCenters.push(cy);
            currentY += h;
        }
        // Root → each child (always lineage)
        for (let i = 0; i < root.children.length; i++) {
            emitConnector(0, 0, childGenX, childCenters[i], 'descendant', root, root.children[i], true);
        }
    }

    // Add root at origin, centered in cross-axis
    emit(root, 0, -crossAxisCardSize / 2);

    return { nodes: positioned, connectors };
}
