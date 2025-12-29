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
        .sort((a, b) => a.sort_date.localeCompare(b.sort_date));

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