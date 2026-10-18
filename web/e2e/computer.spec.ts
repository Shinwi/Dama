import { expect, test } from '@playwright/test';

test('vs computer (Beginner), the computer replies', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();

  await page.locator('button[data-square="b4"]').click();
  await page.locator('button[data-square="a5"]').click();

  // The computer (Dark) should reply and hand the turn back to Light.
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
});

test('undo restores the starting position', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Beginner', exact: true }).click();

  await page.locator('button[data-square="b4"]').click();
  await page.locator('button[data-square="a5"]').click();
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  await expect(page.locator('[data-testid="piece"][data-square="b4"][data-color="light"]')).toBeVisible();
  await expect(page.locator('[data-testid="piece"][data-square="a5"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});

test('playing Dark makes the computer open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();

  // The computer plays Light and should move without any input from us.
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});
