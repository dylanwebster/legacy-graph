// src/core/GraphCache.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { Person } from '../schemas/PersonSchema';

export const CACHE_SPEC_VERSION = '5.0';

export interface CacheEntry {
    data: Person;
    mtime: number; // epoch ms (integer)
}

export interface GraphCacheFile {
    spec_version: string;
    created_at: string;
    entries: Record<string, CacheEntry>; // keyed by absolute file path
}

export class GraphCache {
    /**
     * Load and validate cache from disk.
     * Returns null if: file missing, corrupt JSON, spec_version mismatch, or invalid structure.
     */
    static async load(cachePath: string): Promise<GraphCacheFile | null> {
        try {
            const content = await fs.readFile(cachePath, 'utf8');
            const parsed = JSON.parse(content);

            if (!parsed || typeof parsed !== 'object') return null;
            if (parsed.spec_version !== CACHE_SPEC_VERSION) return null;
            if (!parsed.entries || typeof parsed.entries !== 'object') return null;

            return parsed as GraphCacheFile;
        } catch {
            return null;
        }
    }

    /**
     * Serialize graph state to cache file on disk.
     * Creates the parent directory if it doesn't exist.
     */
    static async save(
        cachePath: string,
        entries: Array<{ data: Person; filePath: string; mtime: number }>
    ): Promise<void> {
        const cacheData: GraphCacheFile = {
            spec_version: CACHE_SPEC_VERSION,
            created_at: new Date().toISOString(),
            entries: {}
        };

        for (const entry of entries) {
            cacheData.entries[entry.filePath] = {
                data: entry.data,
                mtime: entry.mtime
            };
        }

        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(cacheData), 'utf8');
    }

    /**
     * Delete the cache file (invalidation).
     * Silently succeeds if file doesn't exist.
     */
    static async invalidate(cachePath: string): Promise<void> {
        try {
            await fs.unlink(cachePath);
        } catch {
            // File doesn't exist — fine
        }
    }
}
