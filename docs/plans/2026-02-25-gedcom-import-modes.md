# GEDCOM Import Modes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `mode` parameter to GEDCOM import — `"replace"` (current destructive behavior) or `"additive"` (adds new people, skips duplicates matched by name + birth year) — and surface the choice as a radio group on the import page with mode-appropriate warnings.

**Architecture:** Backend change to `gedcom.ts` conditionally skips the wipe and runs a dedup pass; frontend change to `import.lazy.tsx` adds a radio group, adapts the confirmation dialog, and shows a result banner after an additive import. TDD on the backend first, then the frontend UI.

**Tech Stack:** Fastify, js-yaml, supertest (tests), React 19, Tailwind v4, shadcn/ui (RadioGroup), TanStack Router.

**Design doc:** `docs/plans/2026-02-25-gedcom-import-modes-design.md`

---

### Task 1: Backend — accept `mode` and implement additive logic

**Files:**
- Modify: `src/api/routes/gedcom.ts`
- Test: `tests/api/Server.test.ts`

---

**Step 1: Write three failing tests**

Open `tests/api/Server.test.ts`. Find the existing `describe` blocks and add a new one at the end of the outer `describe('Fastify API Server', ...)` block:

```typescript
describe('POST /api/import/gedcom', () => {
    // Minimal valid GEDCOM with one person: first=Jane, last=Doe, born 1990
    const JANE_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Jane /Doe/
1 SEX F
1 BIRT
2 DATE 15 JUN 1990
0 TRLR`;

    // Minimal valid GEDCOM with one person: first=Test, last=Import, born 2000
    // Matches the fixture person N_test-import-2000-* already in tests/fixtures/data/people/
    const DUPLICATE_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Test /Import/
1 SEX M
1 BIRT
2 DATE 1 JAN 2000
0 TRLR`;

    it('replace mode wipes existing people and writes imported ones', async () => {
        const response = await request
            .post('/api/import/gedcom')
            .field('mode', 'replace')
            .attach('file', Buffer.from(JANE_GED), { filename: 'test.ged', contentType: 'text/plain' });

        expect(response.status).toBe(200);
        expect(response.body.imported).toBe(1);
        // The fixture person should be gone — verify Jane is the only person
        const people = await request.get('/api/people');
        expect(people.body.totalCount).toBe(1);
        expect(people.body.people[0].names[0].first).toBe('Jane');
    });

    it('additive mode adds new people without removing existing ones', async () => {
        const before = await request.get('/api/people');
        const countBefore: number = before.body.totalCount;

        const response = await request
            .post('/api/import/gedcom')
            .field('mode', 'additive')
            .attach('file', Buffer.from(JANE_GED), { filename: 'test.ged', contentType: 'text/plain' });

        expect(response.status).toBe(200);
        expect(response.body.imported).toBe(1);
        expect(response.body.skipped).toBe(0);

        const after = await request.get('/api/people');
        expect(after.body.totalCount).toBe(countBefore + 1);
    });

    it('additive mode skips duplicate matched by name + birth year', async () => {
        const before = await request.get('/api/people');
        const countBefore: number = before.body.totalCount;

        const response = await request
            .post('/api/import/gedcom')
            .field('mode', 'additive')
            .attach('file', Buffer.from(DUPLICATE_GED), { filename: 'dup.ged', contentType: 'text/plain' });

        expect(response.status).toBe(200);
        expect(response.body.imported).toBe(0);
        expect(response.body.skipped).toBe(1);

        const after = await request.get('/api/people');
        expect(after.body.totalCount).toBe(countBefore);
    });
});
```

**Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "POST /api/import/gedcom"
```

Expected: 3 failing tests (route exists but doesn't support `mode` yet).

**Step 3: Implement the changes in `src/api/routes/gedcom.ts`**

Replace the entire file with:

```typescript
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
```

**Note on multipart parsing:** The current code uses `request.file()` (single-file helper from `@fastify/multipart`). To read both the `mode` field and the file in one pass we switch to `request.parts()` (the streaming iterator). This is the correct `@fastify/multipart` API for mixed fields+files. See: https://github.com/fastify/fastify-multipart#usage

**Step 4: Run tests and confirm all three pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "POST /api/import/gedcom"
```

Expected: 3 passing.

**Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all 228+ tests passing.

**Step 6: Commit**

```bash
git add src/api/routes/gedcom.ts tests/api/Server.test.ts
git commit -m "feat: add replace/additive mode to GEDCOM import with dedup"
```

---

### Task 2: Frontend — mode radio group, adapted dialog, result banner

**Files:**
- Modify: `client/src/routes/import.lazy.tsx`

No new test file — verify with TypeScript build.

---

**Step 1: Add the RadioGroup import and mode state**

The shadcn/ui `RadioGroup` component is already available in the project. Open `client/src/routes/import.lazy.tsx`.

Replace the import block at the top:

```typescript
import { createLazyFileRoute } from '@tanstack/react-router';
import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Upload, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
```

Add `mode` and `importResult` to the state block inside `ImportPage`:

```typescript
const [file, setFile] = useState<File | null>(null);
const [uploading, setUploading] = useState(false);
const [confirmOpen, setConfirmOpen] = useState(false);
const [progress, setProgress] = useState<{ phase?: string; percent?: number } | null>(null);
const [error, setError] = useState<string | null>(null);
const [mode, setMode] = useState<'replace' | 'additive'>('replace');
const [importResult, setImportResult] = useState<{ imported: number; skipped?: number } | null>(null);
```

**Step 2: Update `handleUpload` to send `mode` and capture `importResult`**

Replace the `handleUpload` function:

```typescript
const handleUpload = useCallback(async () => {
    if (!file) return;
    setConfirmOpen(false);
    setUploading(true);
    setError(null);
    setImportResult(null);

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', mode);

        const response = await fetch('/api/import/gedcom', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error || 'Upload failed');
        }

        const result = await response.json();

        // Listen to hydration stream for progress
        const evtSource = new EventSource('/api/system/hydration/stream');

        evtSource.addEventListener('progress', (e) => {
            try {
                const data = JSON.parse(e.data);
                setProgress({ phase: data.phase, percent: data.percent });
            } catch { /* ignore */ }
        });

        evtSource.addEventListener('complete', () => {
            evtSource.close();
            setUploading(false);
            if (mode === 'additive') {
                setImportResult({ imported: result.imported, skipped: result.skipped });
            } else {
                navigate({ to: '/' });
            }
        });

        evtSource.addEventListener('error', () => {
            evtSource.close();
            setUploading(false);
            setError('Import completed but hydration stream disconnected.');
        });
    } catch (err) {
        setUploading(false);
        setError(err instanceof Error ? err.message : 'Upload failed');
    }
}, [file, mode, navigate]);
```

**Step 3: Replace the JSX return with the updated layout**

Replace everything from `return (` to the closing `);` with:

```tsx
return (
    <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="w-full max-w-lg space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Import GEDCOM</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Upload a GEDCOM (.ged) file to populate the graph.
                </p>
            </div>

            {/* Drop zone */}
            <label
                htmlFor="gedcom-upload"
                className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-muted/30 hover:border-muted-foreground/30 transition-colors"
            >
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                    <p className="text-sm font-medium">{file ? file.name : 'Click to select or drag a .ged file'}</p>
                    {file && (
                        <p className="text-xs text-muted-foreground mt-1">
                            {(file.size / 1024).toFixed(1)} KB
                        </p>
                    )}
                </div>
                <Input
                    id="gedcom-upload"
                    type="file"
                    accept=".ged"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </label>

            {/* Mode selector */}
            <div className="space-y-3">
                <p className="text-sm font-medium">Import mode</p>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'replace' | 'additive')} className="space-y-2">
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="replace" id="mode-replace" />
                        <Label htmlFor="mode-replace" className="cursor-pointer">Replace existing people</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <RadioGroupItem value="additive" id="mode-additive" />
                        <Label htmlFor="mode-additive" className="cursor-pointer">Add to existing people</Label>
                    </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                    {mode === 'replace'
                        ? 'All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed.'
                        : 'People from this file will be added to your existing data. Duplicates are detected by matching first name, last name, and birth year — matched records will be skipped to preserve any hand-crafted edits. Name or date discrepancies may still result in duplicates.'}
                </p>
            </div>

            {error && (
                <Badge variant="destructive" className="w-full justify-center py-2">
                    {error}
                </Badge>
            )}

            {/* Additive import result banner */}
            {importResult && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Import complete</p>
                        <p className="text-xs text-muted-foreground">
                            {importResult.imported} {importResult.imported === 1 ? 'person' : 'people'} added
                            {importResult.skipped != null && importResult.skipped > 0
                                ? `, ${importResult.skipped} duplicate${importResult.skipped === 1 ? '' : 's'} skipped`
                                : ''}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => navigate({ to: '/' })}>
                        Go to dashboard
                    </Button>
                </div>
            )}

            {/* Upload progress */}
            {uploading && progress && (
                <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground">
                        <span>{progress.phase || 'Processing...'}</span>
                        {progress.percent !== undefined && <span>{Math.round(progress.percent)}%</span>}
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progress.percent || 0}%` }}
                        />
                    </div>
                </div>
            )}

            <Button
                className="w-full"
                size="lg"
                disabled={!file || uploading || !!importResult}
                onClick={() => setConfirmOpen(true)}
            >
                {uploading ? (
                    <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...
                    </>
                ) : (
                    'Import File'
                )}
            </Button>

            {/* Confirmation Dialog */}
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {mode === 'replace' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
                            {mode === 'replace' ? 'Destructive Action' : 'Add to Existing Data'}
                        </DialogTitle>
                        <DialogDescription>
                            {mode === 'replace'
                                ? 'All existing people will be permanently deleted and replaced with records from this file. Git history is preserved, so you can revert if needed. Are you sure?'
                                : 'People from this file will be added to your existing data. Duplicates matched by name and birth year will be skipped. Name or date discrepancies may still result in duplicates. Continue?'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                        <Button
                            variant={mode === 'replace' ? 'destructive' : 'default'}
                            onClick={handleUpload}
                        >
                            {mode === 'replace' ? 'Yes, Replace All' : 'Yes, Import'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    </div>
);
```

**Step 4: TypeScript check**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: `✓ built in` with 0 errors. Fix any type errors before proceeding.

**Step 5: Check RadioGroup is available**

If step 4 fails with `Cannot find module '@/components/ui/radio-group'`, install it:

```bash
cd client && npx shadcn@latest add radio-group
```

Then re-run the build check.

**Step 6: Commit**

```bash
git add client/src/routes/import.lazy.tsx
git commit -m "feat: add replace/additive mode UI to GEDCOM import page"
```
