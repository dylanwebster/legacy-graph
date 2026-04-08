import { describe, it, expect } from 'vitest';
import {
    buildAncestorTree,
    buildFamilyTree,
    computeFanArcLayout,
    computeAdaptiveTreeLayout,
    type AncestorSlot,
    type FamilyTreeNode,
} from '../../client/src/utils/genealogyLayout';

// ─── Test Data ───────────────────────────────────────────────────────────────
// A 3-generation family:
//
//   GP_F (paternal grandfather) + GP_M (paternal grandmother)
//        └── FATHER
//   MGP_F (maternal grandfather) + MGP_M (maternal grandmother)
//        └── MOTHER
//            FATHER + MOTHER
//                └── ROOT
//                └── SIBLING
//
// API link convention: source = CHILD, target = PARENT

const nodes = [
    { id: 'ROOT', label: 'Root Person', sex: 'M' },
    { id: 'SIBLING', label: 'Sibling Person', sex: 'F' },
    { id: 'FATHER', label: 'Father Person', sex: 'M' },
    { id: 'MOTHER', label: 'Mother Person', sex: 'F' },
    { id: 'GP_F', label: 'Paternal Grandfather', sex: 'M' },
    { id: 'GP_M', label: 'Paternal Grandmother', sex: 'F' },
    { id: 'MGP_F', label: 'Maternal Grandfather', sex: 'M' },
    { id: 'MGP_M', label: 'Maternal Grandmother', sex: 'F' },
    { id: 'CHILD1', label: 'Child One', sex: 'M' },
];

// API convention: source = child, target = parent
const links = [
    { source: 'ROOT', target: 'FATHER', type: 'parent_child' },
    { source: 'ROOT', target: 'MOTHER', type: 'parent_child' },
    { source: 'SIBLING', target: 'FATHER', type: 'parent_child' },
    { source: 'SIBLING', target: 'MOTHER', type: 'parent_child' },
    { source: 'FATHER', target: 'GP_F', type: 'parent_child' },
    { source: 'FATHER', target: 'GP_M', type: 'parent_child' },
    { source: 'MOTHER', target: 'MGP_F', type: 'parent_child' },
    { source: 'MOTHER', target: 'MGP_M', type: 'parent_child' },
    { source: 'CHILD1', target: 'ROOT', type: 'parent_child' },
    // Spouse link (should be ignored by buildAncestorTree)
    { source: 'FATHER', target: 'MOTHER', type: 'spouse' },
];

// ─── buildAncestorTree ───────────────────────────────────────────────────────

describe('buildAncestorTree', () => {
    it('places root at generation 0, slot 0', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const root = slots.find(s => s.generation === 0 && s.slotIndex === 0);
        expect(root).toBeDefined();
        expect(root!.id).toBe('ROOT');
        expect(root!.label).toBe('Root Person');
    });

    it('places PARENTS at generation 1 (not children)', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const gen1 = slots.filter(s => s.generation === 1);
        expect(gen1).toHaveLength(2);
        const gen1Ids = gen1.map(s => s.id).sort();
        // Generation 1 should be FATHER and MOTHER, not CHILD1 or SIBLING
        expect(gen1Ids).toEqual(['FATHER', 'MOTHER']);
    });

    it('does NOT include descendants (CHILD1, SIBLING) in ancestor tree', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const allIds = slots.map(s => s.id).filter(Boolean);
        expect(allIds).not.toContain('CHILD1');
        expect(allIds).not.toContain('SIBLING');
    });

    it('places grandparents at generation 2 with correct Ahnentafel slots', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const gen2 = slots.filter(s => s.generation === 2);
        expect(gen2).toHaveLength(4);

        // Father is at gen1 slot0 → his parents at gen2 slots 0,1
        // Mother is at gen1 slot1 → her parents at gen2 slots 2,3
        const fatherSlot = slots.find(s => s.generation === 1 && s.id === 'FATHER');
        const motherSlot = slots.find(s => s.generation === 1 && s.id === 'MOTHER');

        // Father should be slot 0 or 1, Mother the other
        expect(fatherSlot).toBeDefined();
        expect(motherSlot).toBeDefined();

        // Get the paternal grandparent slots (2 * fatherSlot, 2 * fatherSlot + 1)
        const paternalGPSlots = gen2.filter(
            s => s.slotIndex === fatherSlot!.slotIndex * 2 || s.slotIndex === fatherSlot!.slotIndex * 2 + 1
        );
        const paternalGPIds = paternalGPSlots.map(s => s.id).sort();
        expect(paternalGPIds).toEqual(['GP_F', 'GP_M']);

        // Maternal grandparent slots
        const maternalGPSlots = gen2.filter(
            s => s.slotIndex === motherSlot!.slotIndex * 2 || s.slotIndex === motherSlot!.slotIndex * 2 + 1
        );
        const maternalGPIds = maternalGPSlots.map(s => s.id).sort();
        expect(maternalGPIds).toEqual(['MGP_F', 'MGP_M']);
    });

    it('creates null slots for missing ancestors', () => {
        // GP_F has no parents in the data → gen 3 slots for his ancestors should be null
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const gen3 = slots.filter(s => s.generation === 3);
        expect(gen3).toHaveLength(8); // 2^3 = 8 slots
        // All gen3 should have null ids since no great-grandparents exist in data
        for (const s of gen3) {
            expect(s.id).toBeNull();
        }
    });

    it('handles root with no parents', () => {
        const loneNode = [{ id: 'LONE', label: 'Lone Person', sex: 'U' }];
        const slots = buildAncestorTree(loneNode, [], 'LONE', 2);
        const root = slots.find(s => s.generation === 0);
        expect(root!.id).toBe('LONE');
        // Gen 1 should have 2 null slots (unknown parents)
        const gen1 = slots.filter(s => s.generation === 1);
        expect(gen1).toHaveLength(2);
        expect(gen1[0].id).toBeNull();
        expect(gen1[1].id).toBeNull();
    });

    it('respects maxGenerations limit', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 1);
        const maxGen = Math.max(...slots.map(s => s.generation));
        expect(maxGen).toBe(1);
        // Should have root + 2 parents = 3 slots
        expect(slots).toHaveLength(3);
    });
});

// ─── computeFanArcLayout ─────────────────────────────────────────────────────

describe('computeFanArcLayout', () => {
    it('returns no arcs for root-only tree', () => {
        const slots: AncestorSlot[] = [
            { id: 'ROOT', label: 'Root', sex: 'M', generation: 0, slotIndex: 0 },
        ];
        const arcs = computeFanArcLayout(slots, 600);
        expect(arcs).toHaveLength(0);
    });

    it('returns arcs for each non-root slot', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 2);
        const arcs = computeFanArcLayout(slots, 600);
        // slots: 1 root + 2 gen1 + 4 gen2 = 7; arcs = 6 (excluding root)
        expect(arcs).toHaveLength(6);
    });

    it('arcs for a generation span the full 270deg (1.5*PI)', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 1);
        const arcs = computeFanArcLayout(slots, 600);
        // Gen 1 has 2 arcs that should together span 270deg
        expect(arcs).toHaveLength(2);
        const startAngles = arcs.map(a => a.startAngle);
        const endAngles = arcs.map(a => a.endAngle);
        const minAngle = Math.min(...startAngles);
        const maxAngle = Math.max(...endAngles);
        const totalSpan = maxAngle - minAngle;
        expect(totalSpan).toBeCloseTo(1.5 * Math.PI, 1);
    });

    it('uses containerSize (min dimension) for ring scaling', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const smallArcs = computeFanArcLayout(slots, 300);
        const largeArcs = computeFanArcLayout(slots, 800);
        // Outer ring should be larger with more space
        const smallMax = Math.max(...smallArcs.map(a => a.outerR));
        const largeMax = Math.max(...largeArcs.map(a => a.outerR));
        expect(largeMax).toBeGreaterThan(smallMax);
    });

    it('inner radius of gen N equals outer radius of gen N-1', () => {
        const slots = buildAncestorTree(nodes, links, 'ROOT', 3);
        const arcs = computeFanArcLayout(slots, 600);
        const gen1Arc = arcs.find(a => a.slot.generation === 1);
        const gen2Arc = arcs.find(a => a.slot.generation === 2);
        expect(gen1Arc).toBeDefined();
        expect(gen2Arc).toBeDefined();
        expect(gen2Arc!.innerR).toBeCloseTo(gen1Arc!.outerR, 5);
    });
});

// ─── buildFamilyTree ─────────────────────────────────────────────────────────

// Extended test data with more descendants
const extendedNodes = [
    ...nodes,
    { id: 'CHILD2', label: 'Child Two', sex: 'F' },
    { id: 'GRANDCHILD1', label: 'Grandchild One', sex: 'M' },
];

const extendedLinks = [
    ...links,
    { source: 'CHILD2', target: 'ROOT', type: 'parent_child' },
    { source: 'GRANDCHILD1', target: 'CHILD1', type: 'parent_child' },
];

/** Collect all node IDs from a FamilyTreeNode recursively */
function _collectIds(node: FamilyTreeNode): string[] {
    const ids: string[] = [];
    if (node.id) ids.push(node.id);
    for (const p of node.parents) ids.push(..._collectIds(p));
    for (const c of node.children) ids.push(..._collectIds(c));
    for (const s of node.siblings) ids.push(..._collectIds(s));
    return ids;
}

/** Find a node by ID in the tree (BFS) */
function _findNode(root: FamilyTreeNode, id: string): FamilyTreeNode | null {
    const queue: FamilyTreeNode[] = [root];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const n = queue.shift()!;
        if (n.id === id) return n;
        if (n.id) visited.add(n.id);
        for (const p of n.parents) {
            if (p.id && !visited.has(p.id)) queue.push(p);
        }
        for (const c of n.children) {
            if (c.id && !visited.has(c.id)) queue.push(c);
        }
        for (const s of n.siblings) {
            if (s.id && !visited.has(s.id)) queue.push(s);
        }
    }
    return null;
}

describe('buildFamilyTree', () => {
    it('returns root at generation 0', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 3, 3, new Set(), new Set(), new Set());
        expect(tree.id).toBe('ROOT');
        expect(tree.generation).toBe(0);
    });

    it('includes ancestors with negative generations', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 0, new Set(), new Set(), new Set());
        // Root's parents should be at generation -1
        expect(tree.parents.length).toBe(2);
        const parentIds = tree.parents.map(p => p.id).sort();
        expect(parentIds).toEqual(['FATHER', 'MOTHER']);
        expect(tree.parents[0].generation).toBe(-1);

        // Grandparents at generation -2
        const father = tree.parents.find(p => p.id === 'FATHER')!;
        expect(father.parents.length).toBe(2);
        const gpIds = father.parents.map(p => p.id).sort();
        expect(gpIds).toEqual(['GP_F', 'GP_M']);
        expect(father.parents[0].generation).toBe(-2);
    });

    it('includes descendants with positive generations', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        // Root's children
        expect(tree.children.length).toBe(2);
        const childIds = tree.children.map(c => c.id).sort();
        expect(childIds).toEqual(['CHILD1', 'CHILD2']);
        expect(tree.children[0].generation).toBe(1);

        // Grandchild
        const child1 = tree.children.find(c => c.id === 'CHILD1')!;
        expect(child1.children.length).toBe(1);
        expect(child1.children[0].id).toBe('GRANDCHILD1');
        expect(child1.children[0].generation).toBe(2);
    });

    it('includes both ancestors and descendants simultaneously', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 2, new Set(), new Set(), new Set());
        // Ancestors
        expect(tree.parents.length).toBe(2);
        // Descendants
        expect(tree.children.length).toBe(2);
    });

    it('respects ancestor depth limit', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 0, new Set(), new Set(), new Set());
        // Parents visible
        expect(tree.parents.length).toBe(2);
        // Grandparents NOT visible (depth limit 1)
        const father = tree.parents.find(p => p.id === 'FATHER')!;
        expect(father.parents.length).toBe(0);
        // But hasHiddenAncestors should be true (father has parents in data)
        expect(father.hasHiddenAncestors).toBe(true);
    });

    it('respects descendant depth limit', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 1, new Set(), new Set(), new Set());
        expect(tree.children.length).toBe(2);
        const child1 = tree.children.find(c => c.id === 'CHILD1')!;
        // Grandchild NOT visible (depth limit 1)
        expect(child1.children.length).toBe(0);
        expect(child1.hasHiddenDescendants).toBe(true);
    });

    it('sets hasHiddenAncestors when person has parents beyond depth', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 0, new Set(), new Set(), new Set());
        const father = tree.parents.find(p => p.id === 'FATHER')!;
        expect(father.hasHiddenAncestors).toBe(true);
    });

    it('sets hasHiddenDescendants when person has children beyond depth', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 1, new Set(), new Set(), new Set());
        const child1 = tree.children.find(c => c.id === 'CHILD1')!;
        expect(child1.hasHiddenDescendants).toBe(true);
    });

    it('sets hasHiddenSiblings when siblings exist but are not expanded', () => {
        // ROOT has SIBLING as a sibling (shared parents FATHER+MOTHER)
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set());
        expect(tree.hasHiddenSiblings).toBe(true);
        expect(tree.siblings.length).toBe(0);
    });

    it('expands siblings when person ID is in expandedSiblings', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        expect(tree.siblings.length).toBe(1);
        expect(tree.siblings[0].id).toBe('SIBLING');
    });

    it('individually expands ancestors when in expandedAncestors set', () => {
        // Depth 1 + individually expand FATHER to see grandparents
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 0, new Set(['FATHER']), new Set(), new Set());
        const father = tree.parents.find(p => p.id === 'FATHER')!;
        expect(father.parents.length).toBe(2);
        const gpIds = father.parents.map(p => p.id).sort();
        expect(gpIds).toEqual(['GP_F', 'GP_M']);
    });

    it('individually expands descendants when in expandedDescendants set', () => {
        // Depth 1 + individually expand CHILD1 to see grandchild
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 1, new Set(), new Set(['CHILD1']), new Set());
        const child1 = tree.children.find(c => c.id === 'CHILD1')!;
        expect(child1.children.length).toBe(1);
        expect(child1.children[0].id).toBe('GRANDCHILD1');
    });

    it('handles root with no relatives', () => {
        const loneNode = [{ id: 'LONE', label: 'Lone Person', sex: 'U' }];
        const tree = buildFamilyTree(loneNode, [], 'LONE', 3, 3, new Set(), new Set(), new Set());
        expect(tree.id).toBe('LONE');
        expect(tree.parents.length).toBe(0);
        expect(tree.children.length).toBe(0);
        expect(tree.siblings.length).toBe(0);
        expect(tree.hasHiddenAncestors).toBe(false);
        expect(tree.hasHiddenDescendants).toBe(false);
        expect(tree.hasHiddenSiblings).toBe(false);
    });

    it('ancestor-side nodes do NOT have hasHiddenDescendants', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 0, new Set(), new Set(), new Set());
        const father = tree.parents.find(p => p.id === 'FATHER')!;
        expect(father.hasHiddenDescendants).toBe(false);
        // Grandparents too
        const gpF = father.parents.find(p => p.id === 'GP_F')!;
        expect(gpF.hasHiddenDescendants).toBe(false);
    });

    it('descendant-side nodes do NOT have hasHiddenAncestors', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        const child1 = tree.children.find(c => c.id === 'CHILD1')!;
        expect(child1.hasHiddenAncestors).toBe(false);
        const gc1 = child1.children.find(c => c.id === 'GRANDCHILD1')!;
        expect(gc1.hasHiddenAncestors).toBe(false);
    });

    it('expanded sibling leaf nodes do not have hasHiddenAncestors or hasHiddenDescendants', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const sibling = tree.siblings.find(s => s.id === 'SIBLING')!;
        expect(sibling.hasHiddenAncestors).toBe(false);
        expect(sibling.hasHiddenDescendants).toBe(false);
    });
});

// ─── computeAdaptiveTreeLayout ───────────────────────────────────────────────

describe('computeAdaptiveTreeLayout', () => {
    it('positions root node at origin', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 2, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT');
        expect(rootNode).toBeDefined();
        expect(rootNode!.x).toBe(0);
    });

    it('places ancestors to the right of root in horizontal layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 0, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const fatherNode = layout.nodes.find(n => n.node.id === 'FATHER')!;
        expect(fatherNode.x).toBeGreaterThan(rootNode.x);
    });

    it('places descendants to the left of root in horizontal layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const child1Node = layout.nodes.find(n => n.node.id === 'CHILD1')!;
        expect(child1Node.x).toBeLessThan(rootNode.x);
    });

    it('places ancestors ABOVE root in vertical layout (negative y = up)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 0, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'vertical');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const fatherNode = layout.nodes.find(n => n.node.id === 'FATHER')!;
        expect(fatherNode.y).toBeLessThan(rootNode.y);
    });

    it('places descendants BELOW root in vertical layout (positive y = down)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'vertical');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const child1Node = layout.nodes.find(n => n.node.id === 'CHILD1')!;
        expect(child1Node.y).toBeGreaterThan(rootNode.y);
    });

    it('does not overlap sibling nodes horizontally in vertical layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'vertical');
        // Children (same generation) should not overlap in x
        const childNodes = layout.nodes.filter(n => n.node.generation === 1);
        if (childNodes.length >= 2) {
            childNodes.sort((a, b) => a.x - b.x);
            for (let i = 1; i < childNodes.length; i++) {
                expect(childNodes[i].x).toBeGreaterThanOrEqual(childNodes[i - 1].x + childNodes[i - 1].width);
            }
        }
    });

    it('places siblings to the right in vertical layout (greater X)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'vertical');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const siblingNode = layout.nodes.find(n => n.node.id === 'SIBLING')!;
        expect(siblingNode.x).toBeGreaterThan(rootNode.x);
    });

    it('places ancestors at the same Y column (screen) in vertical layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 2, 0, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'vertical');
        const fatherNode = layout.nodes.find(n => n.node.id === 'FATHER')!;
        const motherNode = layout.nodes.find(n => n.node.id === 'MOTHER')!;
        // Both parents are at the same generation → same Y in vertical mode
        expect(fatherNode.y).toBe(motherNode.y);
    });

    it('generates connectors between parent and child nodes', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        // Should have connectors: root→father, root→mother, root→child1, root→child2
        expect(layout.connectors.length).toBeGreaterThanOrEqual(4);
    });

    it('does not overlap sibling nodes vertically in horizontal layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 2, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        // Children should not overlap in y
        const childNodes = layout.nodes.filter(n => n.node.generation === 1);
        if (childNodes.length >= 2) {
            childNodes.sort((a, b) => a.y - b.y);
            for (let i = 1; i < childNodes.length; i++) {
                expect(childNodes[i].y).toBeGreaterThanOrEqual(childNodes[i - 1].y + childNodes[i - 1].height);
            }
        }
    });

    it('handles single-node tree', () => {
        const loneNode = [{ id: 'LONE', label: 'Lone Person', sex: 'U' }];
        const tree = buildFamilyTree(loneNode, [], 'LONE', 3, 3, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        expect(layout.nodes).toHaveLength(1);
        expect(layout.nodes[0].x).toBe(0);
        expect(layout.connectors).toHaveLength(0);
    });

    it('places siblings at the same X column as their node in horizontal layout', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const siblingNode = layout.nodes.find(n => n.node.id === 'SIBLING')!;
        expect(siblingNode.x).toBe(rootNode.x);
    });

    it('places siblings below their node (greater Y)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const siblingNode = layout.nodes.find(n => n.node.id === 'SIBLING')!;
        expect(siblingNode.y).toBeGreaterThan(rootNode.y);
    });

    it('siblings do not overlap with their parent node vertically', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 0, 0, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootNode = layout.nodes.find(n => n.node.id === 'ROOT')!;
        const siblingNode = layout.nodes.find(n => n.node.id === 'SIBLING')!;
        expect(siblingNode.y).toBeGreaterThanOrEqual(rootNode.y + rootNode.height);
    });

    it('siblings are NOT at the next generation column (different X from children)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const child1Node = layout.nodes.find(n => n.node.id === 'CHILD1');
        const siblingNode = layout.nodes.find(n => n.node.id === 'SIBLING')!;
        if (child1Node) {
            expect(siblingNode.x).not.toBe(child1Node.x);
        }
    });

    it('expanded siblings do not overlap other nodes at the same generation column', () => {
        // P1 has 2 parents (GP1, GP2) and 3 siblings (S1-S3).
        // With only max(selfH, parentTotal), the centering offset pushes siblings
        // below the allocated space, causing them to overlap with P2.
        const overlapNodes = [
            { id: 'R', label: 'Root', sex: 'M' },
            { id: 'P1', label: 'Parent 1', sex: 'M' },
            { id: 'P2', label: 'Parent 2', sex: 'F' },
            { id: 'GP1', label: 'Grandparent 1', sex: 'M' },
            { id: 'GP2', label: 'Grandparent 2', sex: 'F' },
            { id: 'S1', label: 'Sibling 1', sex: 'M' },
            { id: 'S2', label: 'Sibling 2', sex: 'M' },
            { id: 'S3', label: 'Sibling 3', sex: 'M' },
        ];
        const overlapLinks = [
            { source: 'R', target: 'P1', type: 'parent_child' },
            { source: 'R', target: 'P2', type: 'parent_child' },
            { source: 'P1', target: 'GP1', type: 'parent_child' },
            { source: 'P1', target: 'GP2', type: 'parent_child' },
            { source: 'S1', target: 'GP1', type: 'parent_child' },
            { source: 'S2', target: 'GP1', type: 'parent_child' },
            { source: 'S3', target: 'GP1', type: 'parent_child' },
        ];
        // Expand P1's siblings
        const tree = buildFamilyTree(overlapNodes, overlapLinks, 'R', 2, 0,
            new Set(), new Set(), new Set(['P1']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');

        const p2Node = layout.nodes.find(n => n.node.id === 'P2')!;
        const sibNodes = layout.nodes.filter(n => ['S1', 'S2', 'S3'].includes(n.node.id ?? ''));
        expect(sibNodes.length).toBe(3);

        for (const sib of sibNodes) {
            // P2 and each sibling are in the same X column; they must not overlap in Y
            const noOverlap = sib.y + sib.height <= p2Node.y || sib.y >= p2Node.y + p2Node.height;
            expect(noOverlap).toBe(true);
        }
    });

    it('sibling connectors are parent-child kind with isLineage false (no bracket connectors)', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set(['ROOT']));
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        // No 'sibling' kind connectors — siblings now use standard parent-child connectors
        expect(layout.connectors.filter(c => c.kind === 'sibling')).toHaveLength(0);
        // Connectors involving SIBLING should exist and have isLineage false
        const sibConnectors = layout.connectors.filter(c => c.id.startsWith('SIBLING-') || c.id.includes('-SIBLING-'));
        expect(sibConnectors.length).toBeGreaterThan(0);
        sibConnectors.forEach(c => expect(c.isLineage).toBe(false));
    });

    it('generates parent-child connectors with kind "parent-child"', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 1, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const pcConnectors = layout.connectors.filter(c => c.kind === 'parent-child');
        expect(pcConnectors.length).toBeGreaterThanOrEqual(4);
    });

    it('direct ancestor connectors have isLineage true', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 0, new Set(), new Set(), new Set());
        const layout = computeAdaptiveTreeLayout(tree, 'horizontal');
        const rootToFather = layout.connectors.find(c => c.id.includes('ROOT') && c.id.includes('FATHER'));
        expect(rootToFather?.isLineage).toBe(true);
    });

    it('FamilyTreeNode.isLineage is true for root and ancestors, false for siblings', () => {
        const tree = buildFamilyTree(extendedNodes, extendedLinks, 'ROOT', 1, 0, new Set(), new Set(), new Set(['ROOT']));
        expect(tree.isLineage).toBe(true);
        expect(tree.parents[0].isLineage).toBe(true);
        const sib = tree.siblings[0]!;
        expect(sib.isLineage).toBe(false);
    });
});
