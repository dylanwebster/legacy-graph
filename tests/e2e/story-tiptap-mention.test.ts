import { test, expect } from '@playwright/test';
import path from 'path';

const GEDCOM_PATH = path.resolve('./tests/e2e/fixtures/sample.ged');

test.describe('CUJ: Story Tiptap Editor with @mention', () => {
    test('creates a story with @mention and verifies it links to person timeline', async ({ page }) => {
        // 1. Import GEDCOM to get test persons (Johann Bach, Maria Magdalena Bach)
        await page.goto('/import');
        await expect(page.getByRole('heading', { name: 'Import GEDCOM' })).toBeVisible();

        const fileInput = page.locator('input[type="file"][accept=".ged"]');
        await fileInput.setInputFiles(GEDCOM_PATH);
        await expect(page.getByText('sample.ged')).toBeVisible();

        await page.getByRole('button', { name: 'Import File' }).click();
        await expect(page.getByText('Destructive Action')).toBeVisible();
        await page.getByRole('button', { name: 'Yes, Replace All' }).click();
        await page.waitForURL('/', { timeout: 30_000 });

        // 2. Navigate to /stories/new
        await page.goto('/stories/new');
        await expect(page).toHaveURL(/\/stories\/new/);

        // 3. Fill in the title
        const titleInput = page.locator('input[placeholder="Story title…"]');
        await expect(titleInput).toBeVisible({ timeout: 5_000 });
        await titleInput.fill('Bach Family Reunion');

        // 4. Click into the Tiptap editor body
        const editor = page.locator('.tiptap[contenteditable="true"]');
        await expect(editor).toBeVisible({ timeout: 5_000 });
        await editor.click();

        // 5. Type some content then trigger @mention
        await page.keyboard.type('Hello ');
        await page.keyboard.type('@Bach');

        // 6. Wait for mention dropdown to appear
        const mentionDropdown = page.locator('[data-mention-list]');
        await expect(mentionDropdown).toBeVisible({ timeout: 5_000 });

        // 7. Select the first result (Johann Bach)
        const firstResult = mentionDropdown.locator('button').first();
        await expect(firstResult).toBeVisible({ timeout: 3_000 });
        await firstResult.click();

        // 8. Verify mention chip appeared in the editor
        const mentionChip = editor.locator('.mention-chip').first();
        await expect(mentionChip).toBeVisible({ timeout: 3_000 });

        // 9. Save / Create the story
        await page.getByRole('button', { name: 'Create' }).click();

        // 10. Should navigate to the story view page
        await page.waitForURL(/\/stories\/bach-family-reunion|\/stories\/[^n]/, { timeout: 15_000 });
        const storyUrl = page.url();
        const storyId = storyUrl.split('/stories/')[1];
        expect(storyId).toBeTruthy();
        expect(storyId).not.toBe('new');

        // 11. Verify the mention is rendered in reader mode
        await expect(page.locator('.prose')).toBeVisible();
        // The mention chip or PersonChip for the Bach person should appear in the body
        const bodyMention = page.locator('.prose [href*="/people/N_"]').first();
        await expect(bodyMention).toBeVisible({ timeout: 5_000 });

        // 12. Navigate to /people, find Johann Bach
        await page.goto('/people');
        const firstRow = page.locator('[data-index="0"]').first();
        await expect(firstRow).toBeVisible({ timeout: 10_000 });

        // Find Johann Bach row specifically
        const bachRow = page.locator('[data-index]').filter({ hasText: 'Bach' }).first();
        await expect(bachRow).toBeVisible({ timeout: 5_000 });
        await bachRow.click();

        // 13. Wait for person detail page
        await page.waitForURL(/\/people\/N_/, { timeout: 10_000 });

        // 14. The story should appear in the person's timeline or mentions
        // Stories mentioning this person are shown in the Timeline tab
        // Click Timeline tab if not already active
        const timelineTab = page.locator('[role="tab"]', { hasText: 'Timeline' }).first();
        if (await timelineTab.isVisible()) {
            await timelineTab.click();
        }

        // Wait for timeline to load and find the story reference
        await page.waitForTimeout(1000); // allow TanStack Query to load

        // The story "Bach Family Reunion" should appear somewhere in the timeline or mentions
        const storyRef = page.getByText('Bach Family Reunion');
        await expect(storyRef).toBeVisible({ timeout: 10_000 });
    });
});
