export type MapScope = 'all' | 'focal' | 'lineage';
export type Granularity = 'year' | 'decade' | 'century';
export type Speed = 0.5 | 1 | 2 | 4;

export interface MapEvent {
    id: string;
    person_id: string;
    person_name: string;
    type: string;
    lat: number;
    lng: number;
    sort_date: string | null;
    sort_end_date: string | null;
    has_assets: boolean;
    place_name: string;
}

export interface MapEventsResponse {
    events: MapEvent[];
    extent: {
        minDate: string | null;
        maxDate: string | null;
        bbox: [number, number, number, number] | null;
    };
}

export type BasemapStatus =
    | { available: true; source: 'local'; path: string; sizeBytes: number; builtAt: string }
    | { available: true; source: 'remote'; remoteUrl: string }
    | { available: false; path: string };
