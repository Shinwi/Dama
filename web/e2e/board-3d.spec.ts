import { expect, Page, test } from '@playwright/test';
import { startGame } from './start';

// Without a GPU (CI runners, headless browsers) WebGL runs on the CPU, so the 3D board is slow
// to draw: give these tests three times the usual timeout.
test.slow();

/** Opens the game in 1v1 with the 3D board, and waits for the scene to be up. */
async function open3d(page: Page): Promise<void> {
  await startGame(page, { mode: '1v1', view: '3D ✨' });
  await expect(page.getByTestId('board-3d-canvas')).toBeVisible({ timeout: 20_000 });
  // The scene's testability hook is set once it's ready to take taps.
  await page.waitForFunction(() => window.dama3d !== undefined);
}

/**
 * Taps a square on the 3D board itself: waits for the camera and pieces to come to rest and
 * for the square to stay put on screen (the canvas resizes a moment after entering full
 * screen), then clicks the canvas there.
 */
async function tapCanvas(page: Page, square: string): Promise<void> {
  let last = { x: NaN, y: NaN };
  await expect(async () => {
    await page.waitForFunction(() => window.dama3d!.idle());
    const point = await page.evaluate((name) => window.dama3d!.project(name), square);
    const moved = Math.hypot(point.x - last.x, point.y - last.y);
    last = point;
    expect(moved).toBeLessThan(1);
  }).toPass({ intervals: [100, 200, 300] });
  await page.mouse.click(last.x, last.y);
}

const piece = (page: Page, square: string) => page.locator(`[data-testid="piece"][data-square="${square}"]`);

test('the 3D board starts with 40 pieces and remembers the choice', async ({ page }) => {
  await open3d(page);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);

  await page.reload();
  await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: '3D ✨' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(page.getByTestId('board-3d-canvas')).toBeVisible({ timeout: 20_000 });
});

test('moves are played by tapping the 3D board', async ({ page }) => {
  await open3d(page);
  await tapCanvas(page, 'b4');
  await tapCanvas(page, 'a5');
  await expect(piece(page, 'a5')).toHaveAttribute('data-color', 'light');
  await expect(page.getByTestId('status')).toContainText('Black to move.');
});

test('the 3D board can be played with the keyboard', async ({ page }) => {
  await open3d(page);
  await page.locator('button[data-square="d4"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('button[data-square="e5"]').focus();
  await page.keyboard.press('Enter');
  await expect(piece(page, 'e5')).toHaveAttribute('data-color', 'light');
  await expect(page.getByTestId('status')).toContainText('Black to move.');
});

test('switching back to 2D keeps the position', async ({ page }) => {
  await open3d(page);
  await tapCanvas(page, 'b4');
  await tapCanvas(page, 'a5');
  await expect(page.getByTestId('status')).toContainText('Black to move.');
  await page.getByRole('group', { name: 'Board view' }).getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByTestId('board-3d-canvas')).toHaveCount(0);
  await expect(page.locator('[data-testid="piece"][data-square="a5"][data-color="light"]')).toBeVisible();
});

test('full screen shows the board and its status line, and moves still play', async ({ page }) => {
  await open3d(page);
  await page.getByRole('button', { name: 'Full screen' }).click();

  const column = page.locator('.board-column');
  await expect(column).toHaveClass(/fullscreen/);
  // The 3D board fills (nearly) the whole screen width; the status line is still there.
  const viewport = page.viewportSize()!;
  const canvas = await page.getByTestId('board-3d-canvas').boundingBox();
  expect(canvas!.width).toBeGreaterThan(viewport.width * 0.9);
  await expect(page.getByTestId('status')).toBeVisible();

  await tapCanvas(page, 'b4');
  await tapCanvas(page, 'a5');
  await expect(piece(page, 'a5')).toHaveAttribute('data-color', 'light');
  await expect(page.getByTestId('status')).toContainText('Black to move.');

  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(column).not.toHaveClass(/fullscreen/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('without the Fullscreen API (Safari on iPhone), the board fills the window instead', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Element.prototype as Partial<Element>).requestFullscreen;
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
  });
  await open3d(page);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('.board-column')).toHaveClass(/fill-window/);

  await page.keyboard.press('Escape');
  await expect(page.locator('.board-column')).not.toHaveClass(/fullscreen/);
});

/** The pieces the hidden board holds (the real position), in the form `dama3d.shown()` uses. */
async function realPosition(page: Page): Promise<string[]> {
  const pieces = await page.locator('[data-testid="piece"]').evaluateAll((elements) =>
    elements.map((e) => `${e.dataset['square']}:${e.dataset['color']}:${e.dataset['king'] === 'true' ? 'king' : 'man'}`),
  );
  return pieces.sort();
}

/** Plays a square with the keyboard, straight away: no waiting for the board to come to rest. */
async function press(page: Page, square: string): Promise<void> {
  await page.locator(`button[data-square="${square}"]`).focus();
  await page.keyboard.press('Enter');
}

test('a move made straight after an nfikh plays out, and the scene ends on the real position', async ({ page }) => {
  await open3d(page);
  // White's a5 could take b6 but plays a3-b4 instead: Black may take a5 by nfikh.
  const status = page.getByTestId('status');
  for (const [from, to, next] of [['b4', 'a5', 'Black'], ['c7', 'b6', 'White'], ['a3', 'b4', 'Black']]) {
    await press(page, from);
    await press(page, to);
    await expect(status).toContainText(`${next} to move.`);
  }

  // The nfikh, then a move 600 ms later, as the computer plays it, while the nfikh is still
  // playing out. Timed in the page, since separate key presses from the test can take longer
  // than that on a slow runner. (A race: without the fix this fails some of the time, not
  // always, on a software renderer.)
  await page.evaluate(async () => {
    const click = (square: string) => document.querySelector<HTMLElement>(`button[data-square="${square}"]`)!.click();
    click('a5');
    await new Promise((resolve) => setTimeout(resolve, 600));
    click('e7');
    click('d6');
  });
  await expect(piece(page, 'd6')).toHaveAttribute('data-color', 'dark');
  await expect(piece(page, 'a5')).toHaveCount(0);

  // Once everything has landed, the 3D scene shows exactly the real position (it used to snap
  // back to the position just after the nfikh, undoing the move).
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => window.dama3d!.idle());
  expect(await page.evaluate(() => window.dama3d!.shown())).toEqual(await realPosition(page));
});
