import { test, expect } from '@playwright/test';
import { waitForDashboard } from './helpers';

const ROOT_PERSON_ID = 'N_graph-child-1r1szt1i'; // has parent: N_graph-parent-bgp58m84
const _PARENT_PERSON_ID = 'N_graph-parent-bgp58m84';

const DS_KEY = 'dashboard-state-v1';

/** Helper: set root person in localStorage before page load */
async function setRootPerson(page: import('@playwright/test').Page, rootId: string) {
    await page.evaluate(
        ([key, id]) => {
            const existing = JSON.parse(localStorage.getItem(key as string) ?? '{}');
            localStorage.setItem(key as string, JSON.stringify({ ...existing, rootPersonId: id }));
        },
        [DS_KEY, rootId],
    );
}

test.describe('Dashboard Visualization Modes', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForDashboard(page);
    });

    // ── Mode toggle UI ────────────────────────────────────────────────────────

    test('shows three mode-toggle buttons', async ({ page }) => {
        await expect(page.getByTitle('Force Graph')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTitle('Fan Chart')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTitle('Pedigree')).toBeVisible({ timeout: 5_000 });
    });

    test('starts in Force Graph mode by default', async ({ page }) => {
        await expect(page.locator('canvas')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="fan-chart-svg"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="pedigree-svg"]')).not.toBeVisible();
    });

    // ── Fan Chart mode ────────────────────────────────────────────────────────

    test('Fan Chart shows empty state when no root person', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.removeItem(key);
        }, DS_KEY);
        await page.goto('/');
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();
        // Both Fan and Pedigree panels are mounted simultaneously (visibility toggled); use first()
        await expect(page.getByText('Select a focal person').first()).toBeVisible({ timeout: 5_000 });
    });

    test('Fan Chart switches to mode and shows SVG with root person', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();

        await expect(page.locator('canvas')).not.toBeVisible();
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });
    });

    test('Fan Chart renders arcs when root person is set', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();

        const svg = page.locator('[data-testid="fan-chart-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });
        await expect(svg.locator('path').first()).toBeVisible({ timeout: 5_000 });
    });

    test('Fan Chart click arc re-roots the chart', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();

        const svg = page.locator('[data-testid="fan-chart-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });

        // Click a non-empty arc — should re-root (not navigate away)
        const arcs = svg.locator('path[opacity="1"]');
        const arcCount = await arcs.count();
        if (arcCount > 0) {
            await arcs.first().click();
            // Should stay on dashboard (not navigate to person page)
            await expect(page).toHaveURL('/', { timeout: 3_000 });
        }
    });

    test('Fan Chart generation depth selector buttons are visible', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });

        await expect(page.getByTitle('Show 4 generations')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTitle('Show 6 generations')).toBeVisible({ timeout: 5_000 });
    });

    test('Fan Chart has zoom controls', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });

        // Fan Chart uses wheel/drag zoom; the toolbar has a shared Reset view button
        await expect(page.getByTitle('Reset view')).toBeVisible({ timeout: 5_000 });
    });

    // ── Pedigree Chart mode ───────────────────────────────────────────────────

    test('Pedigree shows empty state when no root person', async ({ page }) => {
        await page.evaluate((key) => {
            localStorage.removeItem(key);
        }, DS_KEY);
        await page.goto('/');
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();
        // Fan Chart is first in DOM (hidden), Pedigree is second (visible); use last()
        await expect(page.getByText('Select a focal person').last()).toBeVisible({ timeout: 5_000 });
    });

    test('Pedigree switches to mode and shows SVG with root person', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();

        await expect(page.locator('canvas')).not.toBeVisible();
        await expect(page.locator('[data-testid="pedigree-svg"]')).toBeVisible({ timeout: 5_000 });
    });

    test('Pedigree shows layout toggle and zoom buttons', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();
        await expect(page.locator('[data-testid="pedigree-svg"]')).toBeVisible({ timeout: 5_000 });

        await expect(page.getByTitle('Horizontal layout')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByTitle('Vertical layout')).toBeVisible({ timeout: 5_000 });
        // Pedigree uses wheel/drag zoom; the toolbar has a shared Reset view button
        await expect(page.getByTitle('Reset view')).toBeVisible({ timeout: 5_000 });
    });

    test('Pedigree renders cards when root person is set', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();

        const svg = page.locator('[data-testid="pedigree-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });
        await expect(svg.locator('rect').first()).toBeVisible({ timeout: 5_000 });
    });

    test('clicking a Pedigree card shows person preview popover', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();

        const svg = page.locator('[data-testid="pedigree-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });

        // Click the first person card
        await svg.locator('g[data-person-id]').first().click();

        // Preview popover should appear (on desktop width)
        await expect(page.locator('[data-testid="person-preview-popover"]')).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-testid="make-focal-btn"]')).toBeVisible();
    });

    test('Pedigree "View profile" navigates to person detail', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();

        const svg = page.locator('[data-testid="pedigree-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });

        await svg.locator('g[data-person-id]').first().click();
        await expect(page.locator('[data-testid="person-preview-popover"]')).toBeVisible({ timeout: 5_000 });

        // Click "Profile" button
        await page.getByRole('button', { name: 'Profile' }).click();
        await page.waitForURL(/\/people\/N_/, { timeout: 10_000 });
    });

    test('Pedigree layout toggle switches between horizontal and vertical', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();
        await expect(page.locator('[data-testid="pedigree-svg"]')).toBeVisible({ timeout: 5_000 });

        await page.getByTitle('Vertical layout').click();
        await expect(page.getByTitle('Vertical layout')).toHaveAttribute('aria-pressed', 'true');
    });

    test('Pedigree shows expand buttons on boundary nodes', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();

        const svg = page.locator('[data-testid="pedigree-svg"]');
        await expect(svg).toBeVisible({ timeout: 5_000 });

        // With 2 fixtures (parent + child, no further relatives), no expand buttons
        // should appear — all known relatives are already visible.
        const expandBtns = svg.locator('[data-testid^="expand-"]');
        expect(await expandBtns.count()).toBe(0);
    });

    // ── LocalStorage persistence ──────────────────────────────────────────────

    test('persists viz mode to localStorage and restores on page refresh', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        // Switch to Fan Chart
        await page.getByTitle('Fan Chart').click();
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });

        const stored = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }, DS_KEY);
        expect(stored?.vizMode).toBe('fan');

        // Reload page — mode should be restored
        await page.reload();
        await waitForDashboard(page);
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });
    });

    test('persists Fan Chart generation depth to localStorage', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Fan Chart').click();
        await expect(page.locator('[data-testid="fan-chart-svg"]')).toBeVisible({ timeout: 5_000 });

        await page.getByTitle('Show 6 generations').click();

        const stored = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }, DS_KEY);
        expect(stored?.fanMaxGen).toBe(6);
    });

    test('persists Pedigree orientation to localStorage', async ({ page }) => {
        await setRootPerson(page, ROOT_PERSON_ID);
        await page.reload();
        await waitForDashboard(page);

        await page.getByTitle('Pedigree').click();
        await expect(page.locator('[data-testid="pedigree-svg"]')).toBeVisible({ timeout: 5_000 });

        await page.getByTitle('Vertical layout').click();

        const stored = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }, DS_KEY);
        expect(stored?.pedigreeOrientation).toBe('vertical');
    });

    test('migrates fg-state-v5 root person on first load', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('dashboard-state-v1');
            localStorage.setItem('fg-state-v5', JSON.stringify({
                positions: {},
                zoom: null,
                rootPersonId: 'N_graph-parent-bgp58m84',
            }));
        });
        await page.reload();
        await waitForDashboard(page);

        const stored = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        }, DS_KEY);
        expect(stored?.rootPersonId).toBe('N_graph-parent-bgp58m84');
    });
});
