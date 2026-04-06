import { test, expect } from '@playwright/test';
import path from 'path';

const GEDCOM_PATH = path.resolve('./tests/e2e/fixtures/sample.ged');

test.describe('CUJ 1: Import → View → Edit → Persist', () => {
    test('imports a GEDCOM, views a person, edits name, and persists after reload', async ({ page }) => {
        // 1. Navigate to /settings — GEDCOM import lives here (moved from /import)
        await page.goto('/settings');
        await page.waitForURL(/\/settings/, { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Import GEDCOM' })).toBeVisible();

        // 2. Upload the sample .ged file
        const fileInput = page.locator('input[type="file"][accept=".ged"]');
        await fileInput.setInputFiles(GEDCOM_PATH);
        await expect(page.getByText('sample.ged')).toBeVisible();

        // 3. Click "Import File" → confirmation dialog
        await page.getByRole('button', { name: 'Import File' }).click();
        await expect(page.getByText('Destructive Action')).toBeVisible();

        // 4. Confirm import
        await page.getByRole('button', { name: 'Yes, Replace All' }).click();

        // 5. Wait for import to complete and redirect to dashboard
        await page.waitForURL('/', { timeout: 30_000 });

        // 6. Navigate to /people
        await page.goto('/people');
        await page.waitForURL(/\/people/, { timeout: 10_000 });

        // Wait for the first virtualized row to appear (people table uses divs, not anchors)
        const firstRow = page.locator('[data-index="0"]').first();
        await expect(firstRow).toBeVisible({ timeout: 10_000 });
        await firstRow.click();

        // 7. We're on a person detail page
        await page.waitForURL(/\/people\/N_/, { timeout: 10_000 });

        // 8. Click the name to enter edit mode
        const nameButton = page.locator('button:has(h2)').first();
        await nameButton.click();

        // First name input should appear
        const firstNameInput = page.locator('input[placeholder="First name"]');
        await expect(firstNameInput).toBeVisible({ timeout: 5_000 });

        // Clear and type a new first name
        await firstNameInput.fill('EditedJohann');

        // Press Enter to save
        await firstNameInput.press('Enter');

        // Name should update (target the person name h2, not the dialog title h2)
        await expect(page.locator('h2.text-xl')).toContainText('EditedJohann', { timeout: 5_000 });

        // 9. Hard reload
        await page.reload();
        await page.waitForURL(/\/people\/N_/);

        // 10. Name should still be updated after reload
        await expect(page.locator('h2.text-xl')).toContainText('EditedJohann', { timeout: 10_000 });
    });
});
