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
    constructor(private rootDir: string) {}

    async loadAll(): Promise<Story[]> {
        // 1. Glob fetch
        const pattern = path.join(this.rootDir, '*.md').replace(/\\/g, '/');
        const files = await fg(pattern);

        return Promise.all(files.map(async (file) => {
            const raw = await fs.readFile(file, 'utf8');
            const { data, content } = matter(raw);
            const metadata = StorySchema.parse(data);

            const mentions = new Set<string>();
            
            // 2. AST Parsing for Mentions
            remark().use(() => (tree) => {
                visit(tree, 'text', (node: any) => {
                    // Regex for @N_xxxx or [[N_xxxx]] — include hyphens (person IDs use N_first-last-year-nanoid8)
                    const regex = /(@N_[a-zA-Z0-9_-]+)|(\[\[(N_[a-zA-Z0-9_-]+)\]\])/g;
                    let match;
                    while ((match = regex.exec(node.value)) !== null) {
                        const id = match[1] || match[3];
                        if (id) mentions.add(id.replace('@', ''));
                    }
                });
            }).processSync(content);

            return {
                id: path.basename(file),
                metadata,
                content,
                mentions: Array.from(mentions)
            };
        }));
    }
}