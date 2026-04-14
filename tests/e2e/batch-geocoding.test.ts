import { test, expect } from '@playwright/test';

test.describe('CUJ 6: Batch Geocoding — Scan, Review, Edit, Apply', () => {
    let personIds: string[];

    test.beforeAll(async ({ request }) => {
        // Wait for hydration
        let ready = false;
        for (let i = 0; i < 60; i++) {
            const status = await request.get('http://localhost:3000/api/system/status');
            const body = await status.json();
            if (body.hydrationState === 'ready') { ready = true; break; }
            await new Promise(r => setTimeout(r, 1000));
        }
        expect(ready, 'Hydration did not reach ready within 60s').toBe(true);

        // Verify GeoNames DB is available
        const placeCheck = await request.get('http://localhost:3000/api/places/search?q=London');
        if (!placeCheck.ok()) {
            test.skip();
            return;
        }
        const places = await placeCheck.json();
        if (!Array.isArray(places) || places.length === 0) {
            test.skip();
            return;
        }

        // Clear any existing batch geocoding results from prior tests
        await request.delete('http://localhost:3000/api/geocoding/batch/results');

        // Create people with unresolved location strings
        personIds = [];
        const person1 = await request.post('http://localhost:3000/api/people', {
            data: {
                names: [{ first: 'Batch', last: 'TestAlpha', primary: true }],
                sex: 'F',
                events: [
                    { type: 'birth', date: '1 Jan 1900', location: 'London, England' },
                    { type: 'death', date: '1 Jan 1970', location: 'Paris, France' },
                ],
            },
        });
        expect(person1.ok()).toBeTruthy();
        personIds.push((await person1.json()).id);

        const person2 = await request.post('http://localhost:3000/api/people', {
            data: {
                names: [{ first: 'Batch', last: 'TestBeta', primary: true }],
                sex: 'M',
                events: [
                    { type: 'birth', date: '1 Jan 1910', location: 'London, England' },
                ],
            },
        });
        expect(person2.ok()).toBeTruthy();
        personIds.push((await person2.json()).id);
    });

    test.afterAll(async ({ request }) => {
        for (const id of personIds ?? []) {
            await request.delete(`http://localhost:3000/api/people/${id}`);
        }
        await request.delete('http://localhost:3000/api/geocoding/batch/results');
    });

    test('scan, review results, filter, sort, select, and apply batch geocoding', async ({ page }) => {
        // Navigate to settings
        await page.goto('/settings');
        await page.waitForURL(/\/settings/, { timeout: 10_000 });

        // -- Scan --
        const scanButton = page.getByRole('button', { name: 'Scan Locations' });
        await expect(scanButton).toBeVisible({ timeout: 10_000 });
        await scanButton.click();

        // The review dialog should open
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText('Batch Geocoding Results')).toBeVisible();

        // Wait for scan to complete — the "High" filter badge appears when done
        const highBadge = dialog.getByRole('button', { name: /High/ });
        await expect(highBadge).toBeVisible({ timeout: 30_000 });

        // -- Stats badges visible --
        await expect(dialog.getByRole('button', { name: /Medium/ })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Low/ })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /No match/ })).toBeVisible();

        // -- Sort controls visible --
        await expect(dialog.getByRole('button', { name: 'A–Z' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Confidence' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Events', exact: true })).toBeVisible();

        // -- Search --
        const searchInput = dialog.getByPlaceholder('Search locations or matched places...');
        await expect(searchInput).toBeVisible();

        // Search for London — should filter to matching rows
        await searchInput.fill('London');
        // Wait for debounce
        await page.waitForTimeout(300);
        // Should see "London, England" in the results
        await expect(dialog.getByText('London, England', { exact: true })).toBeVisible({ timeout: 5_000 });

        // Clear search
        await searchInput.fill('');
        await page.waitForTimeout(300);

        // -- Filter by confidence --
        await highBadge.click();
        // "Show all" link should appear
        await expect(dialog.getByText('Show all')).toBeVisible();
        // Click "Show all" to reset
        await dialog.getByText('Show all').click();
        await expect(dialog.getByText('Show all')).not.toBeVisible();

        // -- Sort by confidence --
        await dialog.getByRole('button', { name: 'Confidence' }).click();

        // -- Select all visible --
        const selectAllCheckbox = dialog.locator('label').filter({ hasText: /Select all|selected/ }).locator('input[type="checkbox"]');
        if (await selectAllCheckbox.isVisible()) {
            // Check current state — may already have auto-selected
            await selectAllCheckbox.click();
            await page.waitForTimeout(100);
            // Click again to toggle
            await selectAllCheckbox.click();
        }

        // -- Close and reopen to test persistence --
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();

        // Reopen
        const reviewButton = page.getByRole('button', { name: /Review Results/ });
        await expect(reviewButton).toBeVisible();
        await reviewButton.click();
        await expect(dialog).toBeVisible({ timeout: 5_000 });

        // Results should still be there (persisted)
        await expect(highBadge).toBeVisible({ timeout: 5_000 });

        // -- CSV Export --
        const exportButton = dialog.getByRole('button', { name: 'Export CSV' });
        await expect(exportButton).toBeVisible();

        // -- Apply --
        // The "Apply N Selected" button should be enabled (high/medium auto-checked)
        const applyButton = dialog.getByRole('button', { name: /Apply.*Selected/ });
        await expect(applyButton).toBeVisible();
        await expect(applyButton).toBeEnabled();

        // Click apply
        await applyButton.click();

        // Dialog should close and toast should appear
        await expect(dialog).not.toBeVisible({ timeout: 10_000 });

        // After apply, the scan button should reappear (state reset to idle)
        await expect(page.getByRole('button', { name: 'Scan Locations' })).toBeVisible({ timeout: 10_000 });

        // Verify the person's event now has a resolved location
        const personRes = await page.request.get(`http://localhost:3000/api/people/${personIds[0]}`);
        expect(personRes.ok()).toBeTruthy();
        const person = await personRes.json();
        const birthEvent = person.events.find((e: any) => e.type === 'birth');
        expect(birthEvent.location.resolvedAt).toBeDefined();
        expect(birthEvent.location.lat).toBeDefined();
    });

    test('inline place editing persists overrides across dialog close/reopen', async ({ page }) => {
        // Create a fresh person with an unresolved location for this test
        const personRes = await page.request.post('http://localhost:3000/api/people', {
            data: {
                names: [{ first: 'Edit', last: 'TestGamma', primary: true }],
                sex: 'F',
                events: [
                    { type: 'birth', date: '1 Jan 1920', location: 'Springfield, Illinois, USA' },
                ],
            },
        });
        expect(personRes.ok()).toBeTruthy();
        const editPersonId = (await personRes.json()).id;

        try {
            // Clear any prior results and scan fresh
            await page.request.delete('http://localhost:3000/api/geocoding/batch/results');

            // Kick off the scan via API to avoid any stale frontend state
            const startRes = await page.request.post('http://localhost:3000/api/geocoding/batch/start', {
                data: {},
            });
            expect(startRes.ok()).toBeTruthy();
            const startBody = await startRes.json();
            expect(startBody.status).toBe('running');

            // Poll until scan completes
            let scanResults: any = null;
            for (let i = 0; i < 60; i++) {
                const r = await page.request.get('http://localhost:3000/api/geocoding/batch/results');
                if (r.status() === 200) {
                    scanResults = await r.json();
                    break;
                }
                await page.waitForTimeout(100);
            }
            expect(scanResults).not.toBeNull();
            expect(scanResults.stats.total).toBeGreaterThan(0);

            await page.goto('/settings');
            await page.waitForURL(/\/settings/, { timeout: 10_000 });

            // Open the review dialog
            const reviewButton = page.getByRole('button', { name: /Review Results/ });
            await expect(reviewButton).toBeVisible({ timeout: 10_000 });
            await reviewButton.click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible({ timeout: 5_000 });

            // Wait for scan to complete
            await expect(dialog.getByRole('button', { name: /High/ })).toBeVisible({ timeout: 30_000 });

            // Search to narrow the virtualized list to just Springfield
            const searchInput = dialog.getByPlaceholder('Search locations or matched places...');
            await searchInput.fill('Springfield');
            await page.waitForTimeout(300);

            // Find the Springfield row and click edit
            const springfieldText = dialog.getByText('Springfield, Illinois, USA');
            await expect(springfieldText).toBeVisible({ timeout: 5_000 });

            // Click the edit (pencil) button near Springfield — it's in the same row
            const springfieldRow = dialog.locator('label').filter({ hasText: 'Springfield, Illinois, USA' });
            const editButton = springfieldRow.locator('button[title="Edit matched place"]');
            await editButton.click();

            // The PlaceSearchCombobox should appear
            const placeInput = springfieldRow.getByPlaceholder('Search for a place...');
            await expect(placeInput).toBeVisible({ timeout: 3_000 });

            // Type a new place
            await placeInput.fill('London');

            // Wait for dropdown results
            const dropdownItem = springfieldRow.locator('button').filter({ hasText: 'London' }).first();
            await expect(dropdownItem).toBeVisible({ timeout: 10_000 });

            // Select a result
            await dropdownItem.click();

            // Should show "edited" badge
            await expect(springfieldRow.getByText('edited')).toBeVisible({ timeout: 3_000 });

            // Close the dialog
            await dialog.getByRole('button', { name: 'Cancel' }).click();
            await expect(dialog).not.toBeVisible();

            // Reopen — search query ("Springfield") is persisted so the filter is still active
            await page.getByRole('button', { name: /Review Results/ }).click();
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await expect(dialog.getByRole('button', { name: /High/ })).toBeVisible({ timeout: 10_000 });

            // The override should persist — "edited" badge should still be there
            await expect(dialog.getByText('Springfield, Illinois, USA')).toBeVisible({ timeout: 5_000 });
            const springfieldRowAfter = dialog.locator('label').filter({ hasText: 'Springfield, Illinois, USA' });
            await expect(springfieldRowAfter.getByText('edited')).toBeVisible({ timeout: 5_000 });
        } finally {
            await page.request.delete(`http://localhost:3000/api/people/${editPersonId}`);
            await page.request.delete('http://localhost:3000/api/geocoding/batch/results');
        }
    });
});
