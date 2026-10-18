import { expect, test } from '@playwright/test';

test('start position has 20 light and 20 dark pieces', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});

test('1v1 turns alternate between Light and Dark', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '1v1', exact: true }).click();

  await page.locator('button[data-square="b4"]').click();
  await page.locator('button[data-square="a5"]').click();
  await expect(page.locator('[data-testid="piece"][data-square="a5"][data-color="light"]')).toBeVisible();

  await page.locator('button[data-square="c7"]').click();
  await page.locator('button[data-square="d6"]').click();
  await expect(page.locator('[data-testid="piece"][data-square="d6"][data-color="dark"]')).toBeVisible();

  await expect(page.getByTestId('status')).toContainText('Light to move.');
});

test('tapping an illegal target does nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '1v1', exact: true }).click();

  await page.locator('button[data-square="b4"]').click();
  // e5 is an empty middle-row square, nowhere near b4 and not a legal destination.
  await page.locator('button[data-square="e5"]').click();

  await expect(page.locator('[data-testid="piece"][data-square="b4"][data-color="light"]')).toBeVisible();
  await expect(page.locator('[data-testid="piece"][data-square="e5"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
});
