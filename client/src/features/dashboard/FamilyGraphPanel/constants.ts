export const NODE_R = 6;

// Fixed scale: 1 year = 14 canvas units (decade = 140 units wide — gives better temporal spread)
export const PIXELS_PER_YEAR = 14;

// Vertical spacing for topological pre-sort
export const GENERATION_GAP = 80;

// Vertical gap between separate family clusters
export const CLUSTER_GAP = 100;

// Semantic link distances
export const SPOUSE_LINK_DIST = 5;
export const PARENT_CHILD_LINK_DIST = 100;

// Zoom thresholds for time axis resolution
export const ZOOM_CENTURY_MAX = 0.5;   // k < 0.5 → century labels
export const ZOOM_DECADE_MAX = 2.0;    // 0.5 ≤ k < 2.0 → decade labels
// k ≥ 2.0 → year labels

export function yearToX(year: number, midYear: number): number {
    return (year - midYear) * PIXELS_PER_YEAR;
}
