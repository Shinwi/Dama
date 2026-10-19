import { expect, Page, test } from '@playwright/test';

// Dev-only ?position= deep links (issue #4). The dev server Playwright runs against has them.

const piece = (page: Page, square: string) => page.locator(`[data-testid="piece"][data-square="${square}"]`);
const pieces = (page: Page, color: 'light' | 'dark') =>
  page.locator(`[data-testid="piece"][data-color="${color}"]`);

async function tap(page: Page, ...squares: string[]): Promise<void> {
  for (const square of squares) await page.locator(`button[data-square="${square}"]`).click();
}

// Light c3 must jump c3xe5xg7 over d4 and f6 — the multi-jump from rules-cases.json.
const CHAIN = '/?position=L:c3;D:d4,f6,Ka9;t:L';

test('a ?position= link renders exactly that position and side to move', async ({ page }) => {
  await page.goto(CHAIN);

  await expect(page.getByTestId('scenario-banner')).toBeVisible();
  await expect(pieces(page, 'light')).toHaveCount(1);
  await expect(pieces(page, 'dark')).toHaveCount(3);
  await expect(piece(page, 'c3')).toHaveAttribute('data-color', 'light');
  await expect(piece(page, 'a9')).toHaveAttribute('data-king', 'true');
  await expect(page.getByTestId('status')).toHaveText('Your move. You must capture.');
});

test('a multi-jump scenario plays from the deep link', async ({ page }) => {
  await page.goto(CHAIN);
  await page.getByRole('button', { name: '1v1', exact: true }).click();

  await tap(page, 'c3', 'e5', 'g7');

  await expect(piece(page, 'g7')).toHaveAttribute('data-color', 'light');
  await expect(piece(page, 'd4')).toHaveCount(0);
  await expect(piece(page, 'f6')).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('Dark to move.');
});

test('reloading restarts the scenario', async ({ page }) => {
  await page.goto(CHAIN);
  await page.getByRole('button', { name: '1v1', exact: true }).click();
  await tap(page, 'c3', 'g7');
  await expect(piece(page, 'g7')).toHaveCount(1);

  await page.reload();

  expect(page.url()).toContain('position=');
  await expect(piece(page, 'c3')).toHaveAttribute('data-color', 'light');
  await expect(piece(page, 'g7')).toHaveCount(0);
  await expect(pieces(page, 'dark')).toHaveCount(3);
});

test('switching mode replays the scenario instead of the opening', async ({ page }) => {
  await page.goto(CHAIN);
  await page.getByRole('button', { name: '1v1', exact: true }).click();

  await expect(pieces(page, 'light')).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText('Light to move. You must capture.');
});

test('vs computer with Dark to move, the computer replies straight away', async ({ page }) => {
  await page.goto('/?position=L:c3;D:h8;t:D');

  await expect(page.getByTestId('status')).toContainText('Your move.', { timeout: 10_000 });
  await expect(piece(page, 'h8')).toHaveCount(0);
  await expect(pieces(page, 'dark')).toHaveCount(1);
});

test('a position with no legal moves opens on the game-over overlay', async ({ page }) => {
  await page.goto('/?position=L:c3;t:D');

  await expect(page.getByTestId('game-over')).toBeVisible();
  await expect(page.getByTestId('game-over')).toContainText('You win!');
});

test('an invalid code shows the error and the standard opening', async ({ page }) => {
  await page.goto('/?position=L:b1');

  await expect(page.getByTestId('scenario-error')).toContainText('b1 is not a playable square');
  await expect(page.getByTestId('scenario-banner')).toHaveCount(0);
  await expect(pieces(page, 'light')).toHaveCount(20);
  await expect(pieces(page, 'dark')).toHaveCount(20);
});

test('New game leaves the scenario and removes the param', async ({ page }) => {
  await page.goto(CHAIN);

  await page.getByRole('button', { name: 'New game', exact: true }).click();

  await expect(page.getByTestId('scenario-banner')).toHaveCount(0);
  await expect(pieces(page, 'light')).toHaveCount(20);
  expect(page.url()).not.toContain('position=');

  await page.reload();
  await expect(pieces(page, 'light')).toHaveCount(20);
});
