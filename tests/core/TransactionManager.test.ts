// tests/core/TransactionManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { TransactionManager } from '../../src/core/TransactionManager';

const REPO_DIR = path.join(__dirname, 'temp_repo');

describe('TransactionManager', () => {
    let txManager: TransactionManager;

    beforeEach(async () => {
        // Initialize a real git repo for testing
        if (fs.existsSync(REPO_DIR)) fs.rmSync(REPO_DIR, { recursive: true, force: true });
        fs.mkdirSync(REPO_DIR, { recursive: true });
        const git = simpleGit(REPO_DIR);
        await git.init();
        await git.addConfig('user.name', 'Tester');
        await git.addConfig('user.email', 'test@test.com');

        txManager = new TransactionManager(REPO_DIR, { debounceMs: 200 }); // Short debounce for tests
    });

    afterEach(async () => {
        await txManager.destroy();
        fs.rmSync(REPO_DIR, { recursive: true, force: true });
    });

    it('should write file to disk immediately', async () => {
        await txManager.writeFile('people/test.yaml', 'name: Test', 'Test Person');

        const content = fs.readFileSync(path.join(REPO_DIR, 'people/test.yaml'), 'utf8');
        expect(content).toBe('name: Test');
    });

    it('should batch rapid writes into a single git commit', async () => {
        // Write 3 files in rapid succession
        await txManager.writeFile('people/a.yaml', 'name: A', 'Person A');
        await txManager.writeFile('people/b.yaml', 'name: B', 'Person B');
        await txManager.writeFile('people/c.yaml', 'name: C', 'Person C');

        // All 3 files should exist on disk immediately
        expect(fs.existsSync(path.join(REPO_DIR, 'people/a.yaml'))).toBe(true);
        expect(fs.existsSync(path.join(REPO_DIR, 'people/b.yaml'))).toBe(true);
        expect(fs.existsSync(path.join(REPO_DIR, 'people/c.yaml'))).toBe(true);

        // Flush to commit all pending writes (tests batching without timer flakiness)
        await txManager.flush();

        // Verify exactly ONE commit was created (not 3 separate ones)
        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        expect(log.total).toBe(1);
        expect(log.latest?.message).toContain('Update 3 files');
    });

    it('should flush pending changes immediately on demand', async () => {
        await txManager.writeFile('people/flush.yaml', 'name: Flush', 'Flush Test');

        // Flush immediately — don't wait for debounce
        await txManager.flush();

        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        expect(log.total).toBe(1);
        expect(log.latest?.message).toContain('Update 1 file');
    });

    it('should not create empty commits when no pending changes', async () => {
        await txManager.flush(); // Nothing pending

        const git = simpleGit(REPO_DIR);
        try {
            const log = await git.log();
            expect(log.total).toBe(0);
        } catch {
            // No commits at all — expected for an empty repo
        }
    });

    it('should include file labels in commit message', async () => {
        await txManager.writeFile('people/john.yaml', 'name: John', 'John Doe');
        await txManager.writeFile('people/jane.yaml', 'name: Jane', 'Jane Doe');
        await txManager.flush();

        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        expect(log.latest?.message).toContain('John Doe');
        expect(log.latest?.message).toContain('Jane Doe');
    });

    it('should truncate commit messages at 72 chars', async () => {
        // Write many files to create a very long commit message
        for (let i = 0; i < 20; i++) {
            await txManager.writeFile(`people/p${i}.yaml`, `name: Person${i}`, `Person ${i}`);
        }
        await txManager.flush();

        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        // First line of commit message should be ≤72 chars
        const firstLine = log.latest!.message.split('\n')[0];
        expect(firstLine.length).toBeLessThanOrEqual(72);
    });

    it('should handle sequential batches correctly', async () => {
        // First batch
        await txManager.writeFile('people/first.yaml', 'name: First', 'First');
        await txManager.flush();

        // Second batch
        await txManager.writeFile('people/second.yaml', 'name: Second', 'Second');
        await txManager.flush();

        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        expect(log.total).toBe(2);
    });
});
