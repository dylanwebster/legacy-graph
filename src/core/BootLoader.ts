// src/core/BootLoader.ts
import fg from 'fast-glob';
import pLimit from 'p-limit';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { PersonSchema, Person } from '../schemas/PersonSchema';

export class BootLoader {
    private rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
    }

    async loadAll(): Promise<Person[]> {
        // 1. Glob: fetch all yaml paths
        // fast-glob requires forward slashes even on Windows
        const pattern = path.join(this.rootDir, '*.yaml').replace(/\\/g, '/');
        const files = await fg(pattern);

        // 2. Pipeline: Limit concurrency to 50 (Tech Spec 4.1)
        const limit = pLimit(50);

        const promises = files.map((file) =>
            limit(async () => {
                // Read File Stream
                const content = await fs.readFile(file, 'utf8');

                // Parse YAML
                const raw = yaml.load(content);

                // Validate Zod Schema
                return PersonSchema.parse(raw);
            })
        );

        // Wait for all to finish
        const results = await Promise.all(promises);
        return results;
    }
}
