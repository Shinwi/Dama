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

test('the board stays put while messages come and go (the computer thinking, captures)', async ({ page }) => {
  await startGame(page, { difficulty: 'Beginner' });
  const board = page.locator('.board-wrap');
  const top = async () => (await board.boundingBox())!.y;
  const start = await top();
  const seen = new Set<number>();
  // Sample the board's position through a few moves, while "Computer is thinking…" shows and goes.
  for (const [from, to] of [
    ['b4', 'a5'],
    ['d4', 'c5'],
    ['f4', 'g5'],
  ]) {
    await page.locator(`button[data-square="${from}"]`).click();
    await page.locator(`button[data-square="${to}"]`).click().catch(() => {}); // the computer may have blocked it
    for (let i = 0; i < 10; i++) {
      seen.add(Math.round(await top()));
      await page.waitForTimeout(50);
    }
    await expect(page.getByTestId('status')).toHaveText('Your move.');
  }
  expect([...seen]).toEqual([Math.round(start)]);
});

test('quick reactions: yours shows, and the computer answers', async ({ page }) => {
  await startGame(page, { difficulty: 'Beginner' });
  await page.getByTestId('reactions').locator('[data-reaction="good-move"]').click();
  await expect(page.getByTestId('reaction-bubble')).toContainText('You: Good move');
  await expect(page.getByTestId('reaction-bubble')).toHaveAttribute('data-from', 'Computer', { timeout: 4000 });
});
