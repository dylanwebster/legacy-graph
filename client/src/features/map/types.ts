export type MapScope = 'all' | 'focal' | 'lineage';
export type Granularity = 'year' | 'decade' | 'century';
export type Speed = 0.5 | 1 | 2 | 4;

/** Validated shape of /map's URL search params (see routes/map.tsx). */
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

