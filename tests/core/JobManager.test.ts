import { describe, it, expect, beforeEach } from 'vitest';
import { JobManager } from '../../src/core/JobManager';
import type { JobProgress } from '../../src/core/JobManager';

describe('JobManager', () => {
    let manager: JobManager;

    beforeEach(() => {
        manager = new JobManager();
    });

    describe('start()', () => {
        it('returns a job ID and sets status to running', async () => {
            const jobId = manager.start('test-job', async () => 'done');
            expect(jobId).toBeTypeOf('string');
            expect(jobId.length).toBeGreaterThan(0);

            const job = manager.getByType('test-job');
            expect(job).toBeDefined();
            expect(job!.type).toBe('test-job');
            expect(job!.status).toBe('running');
            expect(job!.result).toBeNull();
        });

        it('is idempotent — returns existing job if one is running', () => {
            const id1 = manager.start('test-job', async () => {
                await new Promise(r => setTimeout(r, 100));
                return 'done';
            });
            const id2 = manager.start('test-job', async () => 'other');
            expect(id2).toBe(id1);
        });

        it('allows starting a new job after previous completed', async () => {
            const id1 = manager.start('test-job', async () => 'first');
            // Wait for completion
            await new Promise<void>(resolve => {
                manager.on('job:complete', () => resolve());
            });

            const id2 = manager.start('test-job', async () => 'second');
            expect(id2).not.toBe(id1);
        });

        it('allows different job types concurrently', () => {
            const id1 = manager.start('type-a', async () => {
                await new Promise(r => setTimeout(r, 100));
                return 'a';
            });
            const id2 = manager.start('type-b', async () => {
                await new Promise(r => setTimeout(r, 100));
                return 'b';
            });
            expect(id1).not.toBe(id2);
            expect(manager.getByType('type-a')!.status).toBe('running');
            expect(manager.getByType('type-b')!.status).toBe('running');
        });
    });

    describe('job lifecycle', () => {
        it('transitions to completed with result on success', async () => {
            manager.start('test-job', async () => ({ answer: 42 }));

            const result = await new Promise<any>(resolve => {
                manager.on('job:complete', (data) => resolve(data));
            });

            expect(result.result).toEqual({ answer: 42 });

            const job = manager.getByType('test-job');
            expect(job!.status).toBe('completed');
            expect(job!.result).toEqual({ answer: 42 });
            expect(job!.completedAt).toBeTruthy();
        });

        it('transitions to failed with error message on executor throw', async () => {
            manager.start('test-job', async () => {
                throw new Error('boom');
            });

            const result = await new Promise<any>(resolve => {
                manager.on('job:error', (data) => resolve(data));
            });

            expect(result.error).toBe('boom');

            const job = manager.getByType('test-job');
            expect(job!.status).toBe('failed');
            expect(job!.error).toBe('boom');
            expect(job!.result).toBeNull();
        });

        it('allows starting a new job after previous failed', async () => {
            const id1 = manager.start('test-job', async () => {
                throw new Error('fail');
            });
            await new Promise<void>(resolve => {
                manager.on('job:error', () => resolve());
            });

            const id2 = manager.start('test-job', async () => 'recovered');
            expect(id2).not.toBe(id1);
        });
    });

    describe('progress reporting', () => {
        it('emits job:progress events from the executor callback', async () => {
            const progressEvents: JobProgress[] = [];

            manager.on('job:progress', (data: { jobId: string } & JobProgress) => {
                progressEvents.push({
                    processed: data.processed,
                    total: data.total,
                    percent: data.percent,
                });
            });

            manager.start('test-job', async (emit) => {
                emit({ processed: 1, total: 3, percent: 33 });
                emit({ processed: 2, total: 3, percent: 67 });
                emit({ processed: 3, total: 3, percent: 100 });
                return 'done';
            });

            await new Promise<void>(resolve => {
                manager.on('job:complete', () => resolve());
            });

            expect(progressEvents).toHaveLength(3);
            expect(progressEvents[0]).toEqual({ processed: 1, total: 3, percent: 33 });
            expect(progressEvents[2]).toEqual({ processed: 3, total: 3, percent: 100 });
        });

        it('updates job.progress on each emit', async () => {
            manager.start('test-job', async (emit) => {
                emit({ processed: 5, total: 10, percent: 50 });
                return 'done';
            });

            await new Promise<void>(resolve => {
                manager.on('job:complete', () => resolve());
            });

            const job = manager.getByType('test-job');
            expect(job!.progress).toEqual({ processed: 5, total: 10, percent: 50 });
        });
    });

    describe('getByType()', () => {
        it('returns undefined for unknown type', () => {
            expect(manager.getByType('nonexistent')).toBeUndefined();
        });

        it('returns the most recent job for a type', async () => {
            manager.start('test-job', async () => 'first');
            await new Promise<void>(resolve => {
                manager.on('job:complete', () => resolve());
            });

            const job = manager.getByType('test-job');
            expect(job!.result).toBe('first');
        });
    });

    describe('clear()', () => {
        it('removes a completed job', async () => {
            manager.start('test-job', async () => 'done');
            await new Promise<void>(resolve => {
                manager.on('job:complete', () => resolve());
            });

            manager.clear('test-job');
            expect(manager.getByType('test-job')).toBeUndefined();
        });

        it('is a no-op for unknown types', () => {
            expect(() => manager.clear('nonexistent')).not.toThrow();
        });
    });

    describe('executor runs asynchronously', () => {
        it('does not block the start() call', () => {
            manager.start('test-job', async () => {
                return 'done';
            });
            // The key contract is that start() returns immediately with running status
            expect(manager.getByType('test-job')!.status).toBe('running');
        });
    });
});
