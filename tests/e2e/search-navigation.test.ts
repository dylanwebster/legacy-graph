import { test, expect } from '@playwright/test';
import { waitForDashboard } from './helpers';

test.describe('CUJ 2: Search Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Wait for the app to be ready before interacting
        await page.goto('/');
        await waitForDashboard(page);
    });

    test('opens command palette, searches, and navigates to person detail', async ({ page }) => {
        // beforeEach already navigated to '/' and waited for hydration

        // 1. Open command palette via the search button in the top bar
        await page.getByRole('button', { name: /search/i }).first().click();

        // The command palette / search dialog should open
        // The CommandPalette uses a cmdk dialog
        const cmdInput = page.locator('input[placeholder*="Search"]').first();
        await expect(cmdInput).toBeVisible({ timeout: 5_000 });

        // 2. Type a name that exists in the fixture data
        await cmdInput.type('Bach');

        // 3. Wait for results (toBeVisible timeout covers debounce + network latency)
        const firstResult = page.locator('[cmdk-item], [role="option"]').first();
        await expect(firstResult).toBeVisible({ timeout: 8_000 });

        // 4. Click first result
        await firstResult.click();

        // 5. Assert navigation to /people/:id
        await page.waitForURL(/\/people\/N_/, { timeout: 10_000 });

        // 6. Assert person detail page shows correct name (h2.text-xl is the person name, not dialog title)
        await expect(page.locator('h2.text-xl')).toBeVisible({ timeout: 5_000 });
        const heading = await page.locator('h2.text-xl').innerText();
        expect(heading.toLowerCase()).toContain('bach');
    });

    test('search button in top bar opens command palette', async ({ page }) => {
        await page.goto('/');

        // Click the search button in the top bar
        await page.getByRole('button', { name: /search/i }).first().click();

        // Palette should open
        const cmdInput = page.locator('input[placeholder*="Search"]').first();
        await expect(cmdInput).toBeVisible({ timeout: 5_000 });
    });
});
