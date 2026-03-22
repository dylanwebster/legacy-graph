import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { AssetIndexSchema } from '../schemas/AssetSchema';

const META_REL = path.join('_meta', 'assets.yaml');

const EXIF_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadAssetIndex(dataDir: string): Promise<Record<string, any>> {
    try {
        const raw = await fs.readFile(path.join(dataDir, META_REL), 'utf8');
        return AssetIndexSchema.parse(yaml.load(raw) ?? {});
    } catch {
        return {};
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
