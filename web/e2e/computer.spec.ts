import { expect, test } from '@playwright/test';
import { startGame, tap } from './start';

test('vs computer (Beginner), the computer replies', async ({ page }) => {
  await startGame(page, { mode: 'Vs computer', difficulty: 'Beginner', side: 'White' });

  await tap(page, 'b4', 'a5');

  // The computer (Black) should reply and hand the turn back to White.
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
});

test('undo restores the starting position', async ({ page }) => {
  await startGame(page, { mode: 'Vs computer', difficulty: 'Beginner', side: 'White' });

  await tap(page, 'b4', 'a5');
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  await expect(page.locator('[data-testid="piece"][data-square="b4"][data-color="light"]')).toBeVisible();
  await expect(page.locator('[data-testid="piece"][data-square="a5"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});

test('playing Black makes the computer open', async ({ page }) => {
  await startGame(page, { mode: 'Vs computer', side: 'Black' });

  // The computer plays White and should move without any input from us.
  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});
