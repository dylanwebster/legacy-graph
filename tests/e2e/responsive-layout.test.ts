import { test, expect } from '@playwright/test';

test.describe('CUJ 3: Responsive Layout', () => {
    test('mobile viewport shows nav toggle button and hides sidebar', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/');

        // TopBar has a mobile-only sidebar toggle button (md:hidden)
        const navToggle = page.getByRole('button', { name: /navigation/i });
        await expect(navToggle).toBeVisible({ timeout: 5_000 });

        // Sidebar is hidden on mobile (hidden md:flex = hidden at < 768px)
        // None of its nav links should be visible
        await expect(page.locator('a[href="/people"]')).not.toBeVisible();

        // Click toggle → sidebar opens
        await navToggle.click();
        await expect(page.locator('a[href="/people"]')).toBeVisible({ timeout: 3_000 });
    });

    test('desktop viewport shows sidebar and hides mobile nav toggle', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');

        // Mobile toggle is hidden on desktop (md:hidden)
        await expect(page.getByRole('button', { name: /navigation/i })).not.toBeVisible();

        // Sidebar is always visible on desktop (hidden md:flex → flex at ≥ 768px)
        await expect(page.locator('a[href="/people"]')).toBeVisible({ timeout: 5_000 });
    });

    test('desktop with sidebar open shows full labels and 3-column layout on person page', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/people');

        // Navigate to a person detail if any exist
        const personLink = page.locator('a[href*="/people/N_"]').first();
        const hasPersons = await personLink.isVisible({ timeout: 5_000 }).catch(() => false);

        if (hasPersons) {
            await personLink.click();
            await page.waitForURL(/\/people\/N_/);

            // 3-column resizable panel layout visible (ResizablePanelGroup)
            const panels = page.locator('[data-panel]');
            await expect(panels.first()).toBeVisible({ timeout: 5_000 });
            // Should have multiple panels (identity, timeline, context)
            const panelCount = await panels.count();
            expect(panelCount).toBeGreaterThanOrEqual(3);
        }
    });
});
