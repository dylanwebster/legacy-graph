import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobProgress {
    processed: number;
    total: number;
    percent: number;
}

export interface Job<T = unknown> {
    id: string;
    type: string;
    status: JobStatus;
    progress: JobProgress;
    result: T | null;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
}

/**
 * Lightweight in-memory job manager for long-running background tasks.
 *
 * Events emitted:
 *   'job:progress' — { jobId, processed, total, percent }
 *   'job:complete' — { jobId, result }
 *   'job:error'    — { jobId, error }
 */
export class JobManager extends EventEmitter {
    private jobs = new Map<string, Job>();

    /** Start a background job. One active job per type — returns existing ID if already running. */
    start<T>(type: string, executor: (emit: (progress: JobProgress) => void) => Promise<T>): string {
        const existing = this.jobs.get(type);
        if (existing && (existing.status === 'running' || existing.status === 'pending')) {
            return existing.id;
        }

        const id = randomBytes(8).toString('hex');
        const job: Job<T> = {
            id,
            type,
            status: 'running',
            progress: { processed: 0, total: 0, percent: 0 },
            result: null,
            error: null,
            createdAt: new Date().toISOString(),
            completedAt: null,
        };

        this.jobs.set(type, job as Job);

        const emitProgress = (progress: JobProgress) => {
            job.progress = progress;
            this.emit('job:progress', { jobId: id, ...progress });
        };

        // Run executor on next tick so start() returns immediately
        queueMicrotask(async () => {
            try {
                const result = await executor(emitProgress);
                job.status = 'completed';
                job.result = result;
                job.completedAt = new Date().toISOString();
                this.emit('job:complete', { jobId: id, type, result });
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                job.status = 'failed';
                job.error = message;
                job.completedAt = new Date().toISOString();
                this.emit('job:error', { jobId: id, type, error: message });
            }
        });

        return id;
    }

    /** Get the most recent job for a given type. */
    getByType(type: string): Job | undefined {
        return this.jobs.get(type);
    }

    /** Remove a job by type. */
    clear(type: string): void {
        this.jobs.delete(type);
    }
}
