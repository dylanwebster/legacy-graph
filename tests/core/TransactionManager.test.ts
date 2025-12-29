// tests/core/TransactionManager.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import { TransactionManager } from '../../src/core/TransactionManager';

const REPO_DIR = path.join(__dirname, 'temp_repo');

describe('TransactionManager (ACID)', () => {
    beforeAll(async () => {
        // Initialize a real git repo for testing (simulating the user's data folder)
        if (fs.existsSync(REPO_DIR)) fs.rmSync(REPO_DIR, { recursive: true, force: true });
        fs.mkdirSync(REPO_DIR);
        const git = simpleGit(REPO_DIR);
        await git.init();
        await git.addConfig('user.name', 'Tester');
        await git.addConfig('user.email', 'test@test.com');
    });

    afterAll(() => {
        fs.rmSync(REPO_DIR, { recursive: true, force: true });
    });

    it('should write file and create a git commit', async () => {
        const txManager = new TransactionManager(REPO_DIR);

        // Perform a write operation
        await txManager.writePerson('person.yaml', 'some: yaml', 'Created Person');

        // Verify File System
        const fileContent = fs.readFileSync(path.join(REPO_DIR, 'person.yaml'), 'utf8');
        expect(fileContent).toBe('some: yaml');

        // Verify Git Log
        const git = simpleGit(REPO_DIR);
        const log = await git.log();
        // Assert git log shows exactly 1 commit with our message
        expect(log.total).toBe(1);
        expect(log.latest?.message).toContain('Created Person');
    });
});
