import maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';

let registered = false;
const instances = new Map<string, PMTiles>();

/** Register the pmtiles:// protocol with MapLibre once. */
export function registerPmtilesProtocol() {
    if (registered) return;
    const protocol = new Protocol();
    // MapLibre v5 uses the promise-based signature; pmtiles exposes a compatible `.tile`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MapLibre typings differ between v3/v5
    maplibregl.addProtocol('pmtiles', protocol.tile as any);
    registered = true;
}

export function getPmtilesInstance(url: string): PMTiles {
    let p = instances.get(url);
    if (!p) {
        p = new PMTiles(url);
        instances.set(url, p);
    }
    return p;
}
