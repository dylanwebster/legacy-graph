// src/core/TransactionManager.ts
import { Mutex } from 'async-mutex';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

export class TransactionManager {
    private git: SimpleGit;
    private rootDir: string;
    private writeMutex: Mutex;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.git = simpleGit(rootDir);
        this.writeMutex = new Mutex();
    }

    async writePerson(filename: string, content: string, reason: string): Promise<void> {
        // 1. Run Exclusive (The Mutex)
        // This ensures no two writes happen simultaneously
        await this.writeMutex.runExclusive(async () => {

            // Check Dirty Status 
            const status = await this.git.status();
            if (!status.isClean()) {
                // In Phase 2 we handle 409 Conflict here.
                // For Phase 1, we assume a clean slate or proceed.
            }

            const targetPath = path.join(this.rootDir, filename);

            // 2. Write to File System
            await fs.writeFile(targetPath, content, 'utf8');

            // 3. Git Commit (The Transaction)
            await this.git.add(targetPath);
            await this.git.commit(`Update: ${reason}`);
        });
    }
}
