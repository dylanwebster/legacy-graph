import type { Page } from '@playwright/test';

/**
 * Wait for the dashboard to finish hydrating.
 * Waits for the mode-toggle buttons to appear — they're rendered after the
 * backend responds and React finishes the first paint.
 */
export async function waitForDashboard(page: Page): Promise<void> {
    await page.getByTitle('Force Graph').waitFor({ state: 'visible', timeout: 30_000 });
}
