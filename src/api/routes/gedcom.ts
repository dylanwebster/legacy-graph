import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { GedcomReader } from '../../core/gedcom/Import';
import type { AppInstance } from '../types';

export async function gedcomRoutes(server: FastifyInstance) {
    const { graphEngine, txManager, dataDir } = (server as AppInstance).appServices;

    server.post<{
        Body: { gedcom?: string }
    }>('/api/import/gedcom', async (request, reply) => {
        const { gedcom } = request.body;

        if (!gedcom) {
            return reply.status(400).send({
                error: 'GEDCOM content is required',
                code: 'MISSING_GEDCOM'
            });
        }

        try {
            const reader = new GedcomReader();
            const result = await reader.parse(gedcom);

            if (result.people.length === 0) {
                return reply.status(400).send({
                    error: 'No valid people found in GEDCOM',
                    code: 'INVALID_GEDCOM'
                });
            }

            const peopleDir = path.join(dataDir, 'people');
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
