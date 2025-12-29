import fg from 'fast-glob';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter'; // Parses YAML frontmatter

export interface Story {
    id: string; // The filename
    title: string;
    date?: string;
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
            const parsed = matter(raw); // separates data (yaml) from content (md)

            // Extract Mentions using Regex
            // Matches @N_... or [[N_...]]
            const content = parsed.content;
            const mentionRegex = /(@N_[a-zA-Z0-9]+)|(\[\[(N_[a-zA-Z0-9]+)\]\])/g;
            const mentions = new Set<string>();

            let match;
            while ((match = mentionRegex.exec(content)) !== null) {
                // match[1] is @N_..., match[3] is [[N_...]]
                const id = match[1] || match[3];
                if (id) mentions.add(id.replace('@', '')); // strip @ if present
            }

            return {
                id: path.basename(file),
                title: parsed.data.title || "Untitled",
                date: parsed.data.date,
                content: content,
                mentions: Array.from(mentions)
            };
        }));

        return results;
    }
}