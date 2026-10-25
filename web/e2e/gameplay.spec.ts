import { expect, test } from '@playwright/test';
import { startGame, tap } from './start';

test('start position has 20 white and 20 black pieces', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);
});

test('1v1 turns alternate between White and Black', async ({ page }) => {
  await startGame(page, { mode: '1v1' });

  await tap(page, 'b4', 'a5');
  await expect(page.locator('[data-testid="piece"][data-square="a5"][data-color="light"]')).toBeVisible();

  await tap(page, 'c7', 'd6');
  await expect(page.locator('[data-testid="piece"][data-square="d6"][data-color="dark"]')).toBeVisible();

  await expect(page.getByTestId('status')).toContainText('White to move.');
});

test('an illegal tap says why, keeps the piece selected, and moves nothing', async ({ page }) => {
  await startGame(page, { mode: '1v1' });

  await tap(page, 'b4');
  // e5 is an empty middle-row square, nowhere near b4 and not a legal destination.
  await tap(page, 'e5');

  await expect(page.getByTestId('tap-feedback')).toHaveText("That piece can't go there.");
  await expect(page.locator('button[data-square="b4"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-testid="piece"][data-square="b4"][data-color="light"]')).toBeVisible();
  await expect(page.locator('[data-testid="piece"][data-square="e5"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);

  // Still holding b4: the right square plays it. The message goes away by itself.
  await tap(page, 'a5');
  await expect(page.locator('[data-testid="piece"][data-square="a5"][data-color="light"]')).toBeVisible();
  await expect(page.getByTestId('tap-feedback')).toHaveText('', { timeout: 3000 });
});

test("tapping the other side's piece, or a blocked one, says so", async ({ page }) => {
  await startGame(page, { mode: '1v1' });
  await tap(page, 'c7'); // Black's piece, on White's turn
  await expect(page.getByTestId('tap-feedback')).toHaveText("You can't take that piece.");
  await tap(page, 'a1'); // White's own, boxed in at the back
  await expect(page.getByTestId('tap-feedback')).toHaveText("That piece can't move.");
});

test('nfikh: a piece that skipped a capture can be taken, then the taker moves', async ({ page }) => {
  await startGame(page, { mode: '1v1' });

  const play = async (from: string, to: string) => {
    await tap(page, from, to);
    await expect(page.locator(`[data-testid="piece"][data-square="${to}"]`)).toBeVisible();
  };
  await play('b4', 'c5'); // White
  await play('c7', 'd6'); // Black
  await play('j4', 'i5'); // White
  // Black could take c5 with d6 (d6xb4), but plays elsewhere.
  await play('i7', 'h6');
  await expect(page.getByTestId('status')).toContainText('White to move.');

  // White takes d6 by nfikh. Still White's turn.
  await tap(page, 'd6');
  await expect(page.locator('[data-testid="piece"][data-square="d6"]:not(.captured)')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]:not(.captured)')).toHaveCount(19);
  await expect(page.getByTestId('nfikh-note')).toContainText("White took Black's piece on d6");
  await expect(page.getByTestId('status')).toContainText('White to move.');

  await tap(page, 'a3', 'b4');
  await expect(page.getByTestId('status')).toContainText('Black to move.');
});

test('the home screen sets the board pattern, and Menu goes back to it', async ({ page }) => {
  await startGame(page, { mode: '1v1', board: 'Green' });
  await expect(page.locator('.board')).toHaveAttribute('data-theme', 'green');
  await expect(page.getByTestId('setup-summary')).toHaveText('1v1');

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeVisible();
  // The choices are remembered.
  await expect(page.getByRole('group', { name: 'Board pattern' }).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true');
});
