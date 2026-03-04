import { test, expect } from '@playwright/test';

test.describe('CUJ 2: Search Navigation', () => {
    test.beforeEach(async ({ page }) => {
        // Wait for the backend to be hydrated before searching
        await page.goto('/');
        // Give the app time to hydrate (backend may need a moment)
        await page.waitForTimeout(2_000);
    });

    test('opens command palette, searches, and navigates to person detail', async ({ page }) => {
        await page.goto('/');

        // 1. Open command palette with Cmd+K (Mac) / Ctrl+K
        // Click body first to ensure the page has keyboard focus
        await page.locator('body').click();
        await page.keyboard.press('Meta+k');

        // The command palette / search dialog should open
        // The CommandPalette uses a cmdk dialog
        const cmdInput = page.locator('input[placeholder*="Search"]').first();
        await expect(cmdInput).toBeVisible({ timeout: 5_000 });

        // 2. Type a name that exists in the data (Bach was imported by CUJ 1)
        await cmdInput.type('Bach');

        // 3. Wait for results
        await page.waitForTimeout(600); // debounce + network
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
