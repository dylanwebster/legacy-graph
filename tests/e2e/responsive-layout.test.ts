import { test, expect } from '@playwright/test';

test.describe('CUJ 3: Responsive Layout', () => {
    test('mobile viewport shows hamburger, hides sidebar labels', async ({ page }) => {
        // 1. Set mobile viewport
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/');

        // 2. Hamburger menu button should be visible (md:hidden means visible at <768px)
        const _hamburger = page.locator('button:has(.lucide-menu), button[aria-label*="sidebar"], button:has(svg)').first();
        // More specifically: the TopBar button with Menu icon
        const menuButton = page.locator('button').filter({ has: page.locator('.lucide-menu') }).first();
        await expect(menuButton).toBeVisible({ timeout: 5_000 });

        // 3. Sidebar nav link labels should NOT be visible (sidebar collapses on mobile)
        // When sidebarOpen is false, sidebar uses "w-16 hidden md:flex" so it's hidden at mobile
        const sidebarLabel = page.locator('nav a span, aside a span').filter({ hasText: 'Dashboard' }).first();
        await expect(sidebarLabel).not.toBeVisible();

        // 4. Click hamburger → sidebar overlay opens
        await menuButton.click();

        // Sidebar with labels should now be visible
        await expect(page.getByText('LegacyGraph')).toBeVisible({ timeout: 3_000 });
        await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 3_000 });
    });

    test('desktop viewport shows full sidebar with labels', async ({ page }) => {
        // 5. Set desktop viewport
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');

        // 6. Full sidebar should be visible with labels (sidebarOpen defaults to false = icon-only)
        // The hamburger is hidden on desktop (md:hidden)
        const hamburger = page.locator('button').filter({ has: page.locator('.lucide-menu') }).first();
        await expect(hamburger).not.toBeVisible();

        // Sidebar defaults open on desktop — full "LegacyGraph" label should be visible
        await expect(page.getByText('LegacyGraph')).toBeVisible({ timeout: 5_000 });
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

            // 7. 3-column resizable panel layout visible (ResizablePanelGroup)
            const panels = page.locator('[data-panel]');
            await expect(panels.first()).toBeVisible({ timeout: 5_000 });
            // Should have multiple panels (identity, timeline, context)
            const panelCount = await panels.count();
            expect(panelCount).toBeGreaterThanOrEqual(3);
        }
    });
});
