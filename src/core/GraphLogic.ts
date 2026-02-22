// src/core/GraphLogic.ts
import Graph from 'graphology';
import { Person } from '../schemas/PersonSchema';

export function getSiblings(graph: Graph, personId: string): string[] {
    if (!graph.hasNode(personId)) return [];
    const siblings = new Set<string>();

    // 1. Find Parents (Outgoing neighbors where edge type is 'child_of')
    const parents = graph.outNeighbors(personId).filter(n => {
        // Fix: Use findOutEdge to handle MultiGraph ambiguity
        return graph.findOutEdge(personId, n, (key, attr) => attr.type === 'child_of');
    });

    parents.forEach(p => {
        // 2. Find Children of Parents (Incoming neighbors where edge type is 'child_of')
        const children = graph.inNeighbors(p).filter(child => {
            return graph.findOutEdge(child, p, (key, attr) => attr.type === 'child_of');
        });

        children.forEach(child => {
            if (child !== personId) siblings.add(child);
        });
    });

    return Array.from(siblings);
}

export function getCurrentSpouse(graph: Graph, personId: string) {
    if (!graph.hasNode(personId)) return null;
    const node = graph.getNodeAttributes(personId);
    if (node.type !== 'person') return null;

    const data = node.data as Person;

    // Filter relevant events & Sort
    const events = data.events
        .filter(e => e.type === 'marriage' || e.type === 'divorce')
        .sort((a, b) => (a.sort_date ?? '9999-12-31').localeCompare(b.sort_date ?? '9999-12-31'));

    let spouse: string | null = null;

    for (const e of events) {
        if (e.type === 'marriage') spouse = e.partner_id;
        else if (e.type === 'divorce' && spouse === e.partner_id) spouse = null;
    }

    if (!spouse) return null;

    // Check for Widowhood
    let status = 'married';
    if (graph.hasNode(spouse)) {
        const spouseNode = graph.getNodeAttributes(spouse);
        const spouseData = spouseNode.data as Person;
        // Check if spouse has ANY death event
        if (spouseData.events.some(e => e.type === 'death')) status = 'widowed';
    }

    return { partnerId: spouse, status };
}

/**
 * Compute children of a person (reverse lookup: find all nodes with child_of edges TO this person).
 */
export function getChildren(graph: Graph, personId: string): string[] {
    if (!graph.hasNode(personId)) return [];
    return graph.inNeighbors(personId).filter(child => {
        const nodeAttr = graph.getNodeAttributes(child);
        if (nodeAttr.type !== 'person') return false;
        return graph.findOutEdge(child, personId, (_key, attr) => attr.type === 'child_of');
    });
}

/**
 * Compute the full marriage history for a person.
 * Returns all spouses with their final status (married, divorced, widowed).
 */
export function getAllSpouses(graph: Graph, personId: string): Array<{ id: string; status: string; sortDate: string | null }> {
    if (!graph.hasNode(personId)) return [];
    const node = graph.getNodeAttributes(personId);
    if (node.type !== 'person') return [];

    const data = node.data as Person;
    const events = data.events
        .filter(e => e.type === 'marriage' || e.type === 'divorce')
        .sort((a, b) => (a.sort_date ?? '9999-12-31').localeCompare(b.sort_date ?? '9999-12-31'));

    // Track marriage states keyed by partner_id
    const spouseMap = new Map<string, { id: string; status: string; sortDate: string | null }>();

    for (const e of events) {
        if (e.type === 'marriage') {
            spouseMap.set(e.partner_id, {
                id: e.partner_id,
                status: 'married',
                sortDate: e.sort_date ?? null
            });
        } else if (e.type === 'divorce') {
            const existing = spouseMap.get(e.partner_id);
            if (existing) {
                existing.status = 'divorced';
                existing.sortDate = e.sort_date ?? existing.sortDate;
            }
        }
    }

    // Check for widowed status
    for (const [partnerId, entry] of spouseMap) {
        if (entry.status === 'married' && graph.hasNode(partnerId)) {
            const spouseNode = graph.getNodeAttributes(partnerId);
            const spouseData = spouseNode.data as Person;
            if (spouseData.events.some(e => e.type === 'death')) {
                entry.status = 'widowed';
            }
        }
    }

    return Array.from(spouseMap.values());
}

/**
 * Compute all derived relationships for a single node and store them
 * as a volatile `_computed` attribute. Returns null for non-person nodes.
 *
 * Structure:
 *   _computed: {
 *     currentSpouse: { id, status } | null,
 *     siblings: string[],
 *     children: string[],
 *     allSpouses: Array<{ id, status, sortDate }>
 *   }
 */
export function computeRelationships(graph: Graph, nodeId: string): void {
    if (!graph.hasNode(nodeId)) return;
    const nodeAttr = graph.getNodeAttributes(nodeId);
    if (nodeAttr.type !== 'person') {
        graph.setNodeAttribute(nodeId, '_computed', null);
        return;
    }

    const spouse = getCurrentSpouse(graph, nodeId);
    const currentSpouse = spouse
        ? { id: spouse.partnerId, status: spouse.status }
        : null;

    const siblings = getSiblings(graph, nodeId);
    const children = getChildren(graph, nodeId);
    const allSpouses = getAllSpouses(graph, nodeId);

    graph.setNodeAttribute(nodeId, '_computed', {
        currentSpouse,
        siblings,
        children,
        allSpouses
    });
}

/**
 * Compute _computed for ALL person nodes in the graph.
 * Called at the end of hydration.
 */
export function computeAllRelationships(graph: Graph): void {
    graph.forEachNode((nodeId, attributes) => {
        if (attributes.type === 'person') {
            computeRelationships(graph, nodeId);
        }
    });
}

/**
 * Invalidate and recompute _computed for a node AND all its immediate neighbors.
 * Called after hot-patch changes.
 */
export function invalidateComputed(graph: Graph, nodeId: string): void {
    if (!graph.hasNode(nodeId)) return;

    // Recompute for the changed node
    computeRelationships(graph, nodeId);

    // Recompute for all immediate neighbors (parents, children, spouses)
    const neighbors = new Set<string>();
    graph.forEachNeighbor(nodeId, (neighbor) => {
        neighbors.add(neighbor);
    });

    for (const neighbor of neighbors) {
        if (graph.getNodeAttributes(neighbor).type === 'person') {
            computeRelationships(graph, neighbor);
        }
    }
}

export function getAggregatedAssets(graph: Graph, personId: string): string[] {
    if (!graph.hasNode(personId)) return [];
    const assets = new Set<string>();
    const node = graph.getNodeAttributes(personId);
    const data = node.data as Person;

    // 1. Direct Assets
    data.assets.forEach(a => assets.add(a));

    // 2. Event Assets
    data.events.forEach(e => {
        e.assets.forEach(a => assets.add(a));
    });

    // 3. Story Assets (Transitive)
    // Find neighbors who MENTION this person
    const stories = graph.inNeighbors(personId).filter(n => {
        // Fix: Use findOutEdge to find specific 'mentions' edge
        return graph.findOutEdge(n, personId, (key, attr) => attr.type === 'mentions');
    });

    stories.forEach(storyId => {
        const storyNode = graph.getNodeAttributes(storyId);
        const storyData = storyNode.data;
        // Access strict metadata schema
        if (storyData.metadata && storyData.metadata.assets) {
            storyData.metadata.assets.forEach((a: string) => assets.add(a));
        }
    });

    return Array.from(assets);
}