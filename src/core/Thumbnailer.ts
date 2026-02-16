import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export class Thumbnailer {
    private assetsDir: string;
    private cacheDir: string;

    constructor(assetsDir: string, cacheDir: string) {
        this.assetsDir = assetsDir;
        this.cacheDir = cacheDir;
    }

    /**
     * Gets or generates a thumbnail for the given image filename.
     * Returns the path to the cached thumbnail.
     * 
     * @param filename - The filename of the source image (e.g., "photo.jpg")
     * @param width - The desired width in pixels (height calculated to preserve aspect ratio)
     */
    async getThumbnail(filename: string, width: number): Promise<string> {
        const sourcePath = path.join(this.assetsDir, filename);
        const cacheKey = this.getCacheKey(filename, width);
        const cachePath = path.join(this.cacheDir, cacheKey);

        // Ensure cache directory exists
        await fs.mkdir(this.cacheDir, { recursive: true });

        // Check if cached thumbnail exists and is fresh
        const isCacheFresh = await this.isCacheFresh(sourcePath, cachePath);
        
        if (isCacheFresh) {
            return cachePath;
        }

        // Generate thumbnail
        await this.generateThumbnail(sourcePath, cachePath, width);
        
        return cachePath;
    }

    private getCacheKey(filename: string, width: number): string {
        // Create a unique filename for this size variant
        // Format: originalname_width_hash.webp
        const ext = path.extname(filename);
        const basename = path.basename(filename, ext);
        const hash = crypto.createHash('md5').update(filename).digest('hex').substring(0, 8);
        
        return `${basename}_${width}w_${hash}.webp`;
    }

    private async isCacheFresh(sourcePath: string, cachePath: string): Promise<boolean> {
        try {
            const [sourceStat, cacheStat] = await Promise.all([
                fs.stat(sourcePath),
                fs.stat(cachePath)
            ]);
            
            // Cache is fresh if it's newer than source
            return cacheStat.mtime >= sourceStat.mtime;
        } catch (err) {
            // If either file doesn't exist or error occurs, cache is not fresh
            return false;
        }
    }

    private async generateThumbnail(sourcePath: string, cachePath: string, width: number): Promise<void> {
        try {
            await sharp(sourcePath)
                .resize(width, null, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .webp({ quality: 80 })
                .toFile(cachePath);
        } catch (error) {
            // Re-throw with more context
            throw new Error(`Failed to generate thumbnail for ${sourcePath}: ${error}`);
        }
    }
}
