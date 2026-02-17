// src/core/TransactionManager.ts
import { Mutex } from 'async-mutex';
import git from 'isomorphic-git';
import * as nodeFs from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TransactionManagerOptions {
    debounceMs?: number; // Default: 5000 (5 seconds)
    author?: { name: string; email: string };
}

interface PendingWrite {
    relativePath: string;
    label: string;
}

export class TransactionManager {
    private rootDir: string;
    private writeMutex: Mutex;
    private debounceMs: number;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingWrites: PendingWrite[] = [];
    private commitMutex: Mutex;
    private author: { name: string; email: string };

    constructor(rootDir: string, options: TransactionManagerOptions = {}) {
        this.rootDir = rootDir;
        this.writeMutex = new Mutex();
        this.commitMutex = new Mutex();
        this.debounceMs = options.debounceMs ?? 5000;
        this.author = options.author ?? { name: 'LegacyGraph', email: 'legacygraph@localhost' };
    }

    /**
     * Write a file to disk immediately and queue it for the next batched git commit.
     * The commit fires after `debounceMs` of inactivity.
     */
    async writeFile(relativePath: string, content: string, label: string): Promise<void> {
        await this.writeMutex.runExclusive(async () => {
            const targetPath = path.join(this.rootDir, relativePath);

            // Ensure parent directory exists
            await fs.mkdir(path.dirname(targetPath), { recursive: true });

            // Write to file system immediately
            await fs.writeFile(targetPath, content, 'utf8');

            // Queue for commit
            this.pendingWrites.push({ relativePath, label });

            // Reset debounce timer
            this.resetDebounce();
        });
    }

    /**
     * Track a file that was already written to disk (e.g., binary uploads).
     * Queues it for git staging in the next batched commit.
     */
    async trackFile(relativePath: string, label: string): Promise<void> {
        await this.writeMutex.runExclusive(async () => {
            this.pendingWrites.push({ relativePath, label });
            this.resetDebounce();
        });
    }

    /**
     * Force an immediate commit of all pending changes, bypassing the debounce window.
     * Safe to call even when nothing is pending (no-op).
     */
    async flush(): Promise<void> {
        this.clearDebounce();
        await this.commitPending();
    }

    /**
     * Clean up timers. Call on graceful shutdown.
     */
    async destroy(): Promise<void> {
        this.clearDebounce();
        await this.commitPending();
    }

    /**
     * Returns true if there are pending writes waiting to be committed.
     */
    hasPending(): boolean {
        return this.pendingWrites.length > 0;
    }

    private resetDebounce(): void {
        this.clearDebounce();
        this.debounceTimer = setTimeout(() => {
            this.commitPending().catch(err => {
                console.error('[TransactionManager] Debounced commit failed:', err);
            });
        }, this.debounceMs);
    }

    private clearDebounce(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    /**
     * Commit all pending writes in a single atomic git commit.
     * Uses isomorphic-git (pure JS, in-process — no child-process spawning).
     * Protected by a mutex to prevent concurrent commit operations.
     */
    private async commitPending(): Promise<void> {
        await this.commitMutex.runExclusive(async () => {
            if (this.pendingWrites.length === 0) return;

            // Drain pending writes
            const batch = [...this.pendingWrites];
            this.pendingWrites = [];

            try {
                // Stage all pending files using isomorphic-git
                for (const write of batch) {
                    await git.add({
                        fs: nodeFs,
                        dir: this.rootDir,
                        filepath: write.relativePath
                    });
                }

                // Build commit message (truncated at 72 chars per git convention)
                const message = this.buildCommitMessage(batch);

                // Read author from git config, falling back to configured default
                let author = this.author;
                try {
                    const configName = await git.getConfig({ fs: nodeFs, dir: this.rootDir, path: 'user.name' });
                    const configEmail = await git.getConfig({ fs: nodeFs, dir: this.rootDir, path: 'user.email' });
                    if (configName && configEmail) {
                        author = { name: configName, email: configEmail };
                    }
                } catch {
                    // Use default author if config is not available
                }

                await git.commit({
                    fs: nodeFs,
                    dir: this.rootDir,
                    message,
                    author
                });
            } catch (err: any) {
                console.error('[TransactionManager] Commit failed:', err.message);
                // Re-queue failed writes so they're not lost
                this.pendingWrites.push(...batch);
            }
        });
    }

    /**
     * Build a commit message from the batch of writes.
     * Format: "Update N files: Label1, Label2, ..."
     * Truncated at 72 chars for git convention.
     */
    private buildCommitMessage(batch: PendingWrite[]): string {
        const fileWord = batch.length === 1 ? 'file' : 'files';
        const prefix = `Update ${batch.length} ${fileWord}: `;
        const labels = batch.map(w => w.label).join(', ');
        const full = prefix + labels;

        if (full.length <= 72) return full;

        // Truncate: leave room for "..."
        return full.substring(0, 69) + '...';
    }

    // Legacy method for backward compatibility
    async writePerson(filename: string, content: string, reason: string): Promise<void> {
        await this.writeFile(filename, content, reason);
        await this.flush();
    }
}
