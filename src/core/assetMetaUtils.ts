import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { AssetIndexSchema } from '../schemas/AssetSchema';
import type { Place } from '../schemas/PlaceSchema';

const META_REL = path.join('_meta', 'assets.yaml');

const EXIF_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadAssetIndex(dataDir: string): Promise<Record<string, any>> {
    try {
        const raw = await fs.readFile(path.join(dataDir, META_REL), 'utf8');
        return AssetIndexSchema.parse(yaml.load(raw) ?? {});
    } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return {};
        }
        throw err;
    }
}

export async function saveAssetIndex(
    dataDir: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    index: Record<string, any>,
    txManager: { writeFile: (rel: string, content: string, label: string) => Promise<void> },
): Promise<void> {
    await fs.mkdir(path.join(dataDir, '_meta'), { recursive: true });
    await txManager.writeFile(META_REL, yaml.dump(index), 'asset index');
}

/**
 * Parse a Date object or date string (e.g. from EXIF) to a YYYY-MM-DD string.
 * Returns null for any input that can't be resolved to a valid date.
 */
export function parseExifDateToISO(date: unknown): string | null {
    if (date == null) return null;
    try {
        const d = new Date(date as string | Date);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    } catch {
        return null;
    }
}

/**
 * Convert EXIF GPS DMS arrays + ref strings to a Place object with decimal coordinates.
 * Pure function — useful for testing the math independently of file I/O.
 */
export function parseExifGpsToPlace(
    latDMS: number[],
    latRef: string,
    lngDMS: number[],
    lngRef: string,
): Place {
    const toDecimal = (dms: number[]) => (dms[0] ?? 0) + (dms[1] ?? 0) / 60 + (dms[2] ?? 0) / 3600;
    let lat = toDecimal(latDMS);
    let lng = toDecimal(lngDMS);
    if (latRef === 'S') lat = -lat;
    if (lngRef === 'W') lng = -lng;
    const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
    const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
    return {
        name: `${latStr}, ${lngStr}`,
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6)),
    };
}

/**
 * Attempt to extract GPS coordinates from an image file's EXIF metadata.
 * Returns a Place with decimal lat/lng and a formatted coordinate name, or null.
 * Never throws — all errors return null.
 */
export async function extractExifGps(filepath: string): Promise<Place | null> {
    const ext = path.extname(filepath).toLowerCase();
    if (!EXIF_IMAGE_EXTS.has(ext)) return null;
    try {
        const meta = await sharp(filepath).metadata();
        if (!meta.exif) return null;
        const exif = exifReader(meta.exif);
        const gps = exif.GPSInfo;
        if (!gps?.GPSLatitude || !gps?.GPSLongitude) return null;
        return parseExifGpsToPlace(
            gps.GPSLatitude,
            gps.GPSLatitudeRef ?? 'N',
            gps.GPSLongitude,
            gps.GPSLongitudeRef ?? 'E',
        );
    } catch {
        return null;
    }
}

/**
 * Attempt to extract the original capture date from an image file's EXIF metadata.
 * Returns a YYYY-MM-DD string, or null if no valid date is found or the file is not an image.
 * Never throws — all errors return null.
 */
export async function extractExifDate(filepath: string): Promise<string | null> {
    const ext = path.extname(filepath).toLowerCase();
    if (!EXIF_IMAGE_EXTS.has(ext)) return null;
    try {
        const meta = await sharp(filepath).metadata();
        if (!meta.exif) return null;
        const exif = exifReader(meta.exif);
        const date =
            exif?.Photo?.DateTimeOriginal ??
            exif?.Photo?.DateTimeDigitized ??
            exif?.Image?.DateTime;
        return parseExifDateToISO(date);
    } catch {
        return null;
    }
}
