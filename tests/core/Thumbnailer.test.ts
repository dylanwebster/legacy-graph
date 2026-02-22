import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Thumbnailer } from '../../src/core/Thumbnailer';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

describe('Thumbnailer', () => {
    const TEST_DATA_DIR = path.join(__dirname, '../fixtures/thumbnails-test/images');
    const TEST_CACHE_DIR = path.join(__dirname, '../fixtures/thumbnails-test/cache');
    let thumbnailer: Thumbnailer;

    beforeEach(async () => {
        // Create test directories
        await fs.mkdir(TEST_DATA_DIR, { recursive: true });
        await fs.mkdir(TEST_CACHE_DIR, { recursive: true });

        // Create a test image (100x100 red square)
        await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        })
            .jpeg()
            .toFile(path.join(TEST_DATA_DIR, 'test.jpg'));

        thumbnailer = new Thumbnailer(TEST_DATA_DIR, TEST_CACHE_DIR);
    });

    afterEach(async () => {
        // Clean up test files
        try {
            await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
            await fs.rm(TEST_CACHE_DIR, { recursive: true, force: true });
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    it('should generate a thumbnail with specified width', async () => {
        const thumbnailPath = await thumbnailer.getThumbnail('test.jpg', 50);

        expect(thumbnailPath).toBeDefined();

        // Verify file exists
        const stats = await fs.stat(thumbnailPath);
        expect(stats.isFile()).toBe(true);

        // Verify dimensions
        const metadata = await sharp(thumbnailPath).metadata();
        expect(metadata.width).toBe(50);
        expect(metadata.height).toBeLessThanOrEqual(50); // Aspect ratio preserved
    });

    it('should cache thumbnails and return cached version on subsequent calls', async () => {
        const firstCall = await thumbnailer.getThumbnail('test.jpg', 50);
        const firstStat = await fs.stat(firstCall);
        const firstMtime = firstStat.mtime.getTime();

        // Wait a tiny bit to ensure mtime would differ if regenerated
        await new Promise(resolve => setTimeout(resolve, 10));

        const secondCall = await thumbnailer.getThumbnail('test.jpg', 50);
        const secondStat = await fs.stat(secondCall);
        const secondMtime = secondStat.mtime.getTime();

        // Should return same path
        expect(secondCall).toBe(firstCall);

        // File should not have been regenerated (mtime unchanged)
        expect(secondMtime).toBe(firstMtime);
    });

    it('should regenerate thumbnail if source image is newer than cache', async () => {
        // Generate initial thumbnail
        const firstPath = await thumbnailer.getThumbnail('test.jpg', 50);
        const firstStat = await fs.stat(firstPath);
        const firstMtime = firstStat.mtime.getTime();

        // Wait and "touch" source to update mtime
        await new Promise(resolve => setTimeout(resolve, 100));

        const sourcePath = path.join(TEST_DATA_DIR, 'test.jpg');
        const now = new Date();
        await fs.utimes(sourcePath, now, now);

        // Get thumbnail again - should regenerate because source is newer
        const secondPath = await thumbnailer.getThumbnail('test.jpg', 50);
        const secondStat = await fs.stat(secondPath);
        const secondMtime = secondStat.mtime.getTime();

        // Path should be same but file should have been regenerated (newer mtime)
        expect(secondPath).toBe(firstPath);
        expect(secondMtime).toBeGreaterThan(firstMtime);
    });

    it('should maintain aspect ratio when resizing', async () => {
        // Create a non-square image (200x100)
        await sharp({
            create: {
                width: 200,
                height: 100,
                channels: 3,
                background: { r: 0, g: 255, b: 0 }
            }
        })
            .jpeg()
            .toFile(path.join(TEST_DATA_DIR, 'wide.jpg'));

        const thumbnailPath = await thumbnailer.getThumbnail('wide.jpg', 100);
        const metadata = await sharp(thumbnailPath).metadata();

        expect(metadata.width).toBe(100);
        expect(metadata.height).toBe(50); // Preserved 2:1 aspect ratio
    });

    it('should throw error for non-existent image', async () => {
        await expect(
            thumbnailer.getThumbnail('nonexistent.jpg', 50)
        ).rejects.toThrow();
    });

    it('should support multiple image formats', async () => {
        // Create PNG test image
        await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 4,
                background: { r: 255, g: 255, b: 0, alpha: 1 }
            }
        })
            .png()
            .toFile(path.join(TEST_DATA_DIR, 'test.png'));

        const thumbnailPath = await thumbnailer.getThumbnail('test.png', 50);

        expect(thumbnailPath).toBeDefined();
        const metadata = await sharp(thumbnailPath).metadata();
        expect(metadata.width).toBe(50);
    });

    it('should generate unique cache filenames for different widths', async () => {
        const thumb50 = await thumbnailer.getThumbnail('test.jpg', 50);
        const thumb100 = await thumbnailer.getThumbnail('test.jpg', 100);

        expect(thumb50).not.toBe(thumb100);

        // Both should exist
        const stat50 = await fs.stat(thumb50);
        const stat100 = await fs.stat(thumb100);

        expect(stat50.isFile()).toBe(true);
        expect(stat100.isFile()).toBe(true);
    });

    it('should output WebP format for web optimization', async () => {
        const thumbnailPath = await thumbnailer.getThumbnail('test.jpg', 50);

        // Check file extension
        expect(thumbnailPath).toMatch(/\.webp$/);

        // Verify format
        const metadata = await sharp(thumbnailPath).metadata();
        expect(metadata.format).toBe('webp');
    });
});
