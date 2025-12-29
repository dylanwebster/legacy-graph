// src/core/StoryLoader.ts
import fg from 'fast-glob';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import { visit } from 'unist-util-visit';
import { StorySchema, StoryMetadata } from '../schemas/StorySchema';

export interface Story {
    id: string; // filename
    metadata: StoryMetadata;
    content: string;
    mentions: string[];
}

export class StoryLoader {
    private rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
    }

    async loadAll(): Promise<Story[]> {
        const pattern = path.join(this.rootDir, '*.md').replace(/\\/g, '/');
        const files = await fg(pattern);

        const results = await Promise.all(files.map(async (file) => {
            const raw = await fs.readFile(file, 'utf8');
            const { data, content } = matter(raw);

            // Validate Metadata
            const metadata = StorySchema.parse(data);

            // Extract Mentions via AST [cite: 193]
            const mentions = new Set<string>();
            const processor = remark().use(() => (tree) => {
                visit(tree, 'text', (node: any) => {
                    // Regex for @N_xxxx or [[N_xxxx]]
                    const regex = /(@N_[a-zA-Z0-9_]+)|(\[\[(N_[a-zA-Z0-9_]+)\]\])/g;
                    let match;
                    while ((match = regex.exec(node.value)) !== null) {
                        // match[1] is @N_..., match[3] is [[N_...]]
                        const id = match[1] || match[3];
                        if (id) mentions.add(id.replace('@', ''));
                    }
                });
            });

            processor.processSync(content);

            return {
                id: path.basename(file),
                metadata,
                content,
                mentions: Array.from(mentions)
            };
        }));

        return results;
    }
}