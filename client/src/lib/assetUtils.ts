const ext = (filename: string) => {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tiff', '.tif', '.svg']);

export type AssetType = 'image' | 'pdf' | 'text' | 'markdown';

export function assetType(filename: string): AssetType | null {
    const e = ext(filename);
    if (IMAGE_EXTS.has(e)) return 'image';
    if (e === '.pdf') return 'pdf';
    if (e === '.txt') return 'text';
    if (e === '.md') return 'markdown';
    return null;
}

export const isImageAsset = (filename: string): boolean => IMAGE_EXTS.has(ext(filename));

/** Returns the first image filename from an assets array, or undefined. */
export const primaryImageAsset = (assets: string[]): string | undefined =>
    assets.find(isImageAsset);
