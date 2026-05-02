export const EVENT_TYPES = [
    'birth', 'death', 'marriage', 'divorce', 'engagement', 'residence',
    'occupation', 'education', 'military_service', 'baptism', 'burial',
    'immigration', 'emigration', 'adoption', 'census', 'generic',
] as const;

export type EventType = typeof EVENT_TYPES[number];

// Weights used to feed HeatmapLayer; birth/death/marriage carry more mass than
// decadal records like census. Scaled loosely so one marriage ≈ 1 "light".
export const TYPE_WEIGHTS: Record<EventType, number> = {
    birth: 1.0, death: 1.0, marriage: 1.0, divorce: 0.7,
    engagement: 0.6, residence: 0.6, occupation: 0.6,
    education: 0.5, military_service: 0.6,
    baptism: 0.5, burial: 0.5,
    immigration: 0.7, emigration: 0.7, adoption: 0.6,
    census: 0.3, generic: 0.4,
};

// Distinct colors per event type for the zoomed-in pin layer.
export const TYPE_COLORS: Record<EventType, [number, number, number, number]> = {
    birth: [74, 222, 128, 220],        // emerald
    death: [148, 163, 184, 220],       // slate
    marriage: [250, 204, 21, 220],     // gold
    divorce: [239, 68, 68, 220],       // red
    engagement: [244, 114, 182, 220],  // pink
    residence: [59, 130, 246, 220],    // blue
    occupation: [168, 85, 247, 220],   // purple
    education: [14, 165, 233, 220],    // sky
    military_service: [120, 113, 108, 220], // stone
    baptism: [134, 239, 172, 220],     // mint
    burial: [71, 85, 105, 220],        // deep slate
    immigration: [34, 197, 94, 220],   // green
    emigration: [249, 115, 22, 220],   // orange
    adoption: [217, 70, 239, 220],     // fuchsia
    census: [161, 161, 170, 220],      // zinc
    generic: [100, 116, 139, 220],     // slate-blue
};
