import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { GedcomReader } from '../../core/gedcom/Import';
import type { AppInstance } from '../types';
import type { Person } from '../../schemas/PersonSchema';

function buildDedupKey(person: unknown): string | null {
    const p = person as any;
    const primaryName = p.names?.find((n: any) => n.primary) ?? p.names?.[0];
    if (!primaryName?.first || !primaryName?.last) return null;

    const first = String(primaryName.first).toLowerCase().trim();
    const last = String(primaryName.last).toLowerCase().trim();

    const birthEvent = p.events?.find((e: any) => e.type === 'birth');
    const rawDate = birthEvent?.sort_date || birthEvent?.date;
    const yearMatch = rawDate?.match(/(\d{4})/);
    const birthYear = yearMatch ? yearMatch[1] : null;

    return birthYear ? `${first}|${last}|${birthYear}` : `${first}|${last}`;
}

export async function gedcomRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;

    server.post('/api/import/gedcom', async (request, reply) => {
        let gedcomContent: string | undefined;
        let mode: string = 'replace';

        const contentType = request.headers['content-type'] || '';

        if (contentType.includes('multipart/form-data')) {
            const parts = request.parts();
            const chunks: Buffer[] = [];

            for await (const part of parts) {
                if (part.type === 'field' && part.fieldname === 'mode') {
                    mode = part.value as string;
                } else if (part.type === 'file' && part.fieldname === 'file') {
                    for await (const chunk of part.file) {
                        chunks.push(chunk);
                    }
                    gedcomContent = Buffer.concat(chunks).toString('utf8');
                }
            }
        } else {
            const body = request.body as { gedcom?: string; mode?: string };
            gedcomContent = body?.gedcom;
            mode = body?.mode ?? 'replace';
        }

        if (!gedcomContent) {
            return reply.status(400).send({
                error: 'GEDCOM content is required',
                code: 'MISSING_GEDCOM'
            });
        }

        try {
            const reader = new GedcomReader();
            const result = await reader.parse(gedcomContent);

            if (result.people.length === 0) {
                return reply.status(400).send({
                    error: 'No valid people found in GEDCOM',
                    code: 'INVALID_GEDCOM'
                });
            }

            const peopleDir = path.join(dataDir, 'people');

            if (mode === 'additive') {
                // Build dedup set from existing people
                const existingFiles = await fs.readdir(peopleDir).catch(() => [] as string[]);
                const dedupKeys = new Set<string>();

                for (const filename of existingFiles.filter(f => f.endsWith('.yaml'))) {
                    try {
                        const content = await fs.readFile(path.join(peopleDir, filename), 'utf8');
                        const existing = yaml.load(content);
                        const key = buildDedupKey(existing);
                        if (key) dedupKeys.add(key);
                    } catch { /* skip unparseable files */ }
                }

                let skipped = 0;
                const toWrite: Person[] = [];
                for (const person of result.people) {
                    const key = buildDedupKey(person);
                    if (key && dedupKeys.has(key)) {
                        skipped++;
                    } else {
                        toWrite.push(person);
                    }
                }

                await fs.mkdir(peopleDir, { recursive: true });
                for (const person of toWrite) {
                    const relativePath = path.join('people', `${person.id}.yaml`);
                    const primaryName = person.names?.[0];
                    const label = primaryName ? `${primaryName.first} ${primaryName.last}` : person.id;
                    await txManager.writeFile(relativePath, yaml.dump(person), label);
                }

                await txManager.flush();
                await graphEngine.hydrate();

                return {
                    imported: toWrite.length,
                    skipped,
                    warnings: result.warnings
                };
            } else {
                // Replace mode: wipe and rewrite
                try {
                    const files = await fs.readdir(peopleDir);
                    await Promise.all(
                        files
                            .filter(f => f.endsWith('.yaml'))
                            .map(f => fs.unlink(path.join(peopleDir, f)))
                    );
                } catch {
                    await fs.mkdir(peopleDir, { recursive: true });
                }

                for (const person of result.people) {
                    const relativePath = path.join('people', `${person.id}.yaml`);
                    const primaryName = person.names?.[0];
                    const label = primaryName ? `${primaryName.first} ${primaryName.last}` : person.id;
                    await txManager.writeFile(relativePath, yaml.dump(person), label);
                }

                await txManager.flush();
                await graphEngine.hydrate();

                return {
                    imported: result.people.length,
                    warnings: result.warnings
                };
            }
        } catch (error: any) {
            console.error('[API] GEDCOM import error:', error);
            return reply.status(400).send({
                error: 'Failed to parse GEDCOM',
                code: 'INVALID_GEDCOM',
                details: error.message
            });
        }
    });
}
