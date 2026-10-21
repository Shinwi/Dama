import { expect, Page, test } from '@playwright/test';

// Without a GPU (CI runners, headless browsers) WebGL runs on the CPU, so the 3D board is slow
// to draw: give these tests three times the usual timeout.
test.slow();

/** Opens the game in 1v1 with the 3D board, and waits for the scene to be up. */
async function open3d(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: '1v1', exact: true }).click();
  await page.getByRole('button', { name: '3D ✨' }).click();
  await expect(page.getByTestId('board-3d-canvas')).toBeVisible({ timeout: 20_000 });
  // The scene's testability hook is set once it's ready to take taps.
  await page.waitForFunction(() => window.dama3d !== undefined);
}

/**
 * Taps a square on the 3D board itself: waits for the camera and pieces to come to rest,
 * projects the square to the screen and clicks the canvas there.
 */
async function tapCanvas(page: Page, square: string): Promise<void> {
  await page.waitForFunction(() => window.dama3d!.idle());
  const point = await page.evaluate((name) => window.dama3d!.project(name), square);
  await page.mouse.click(point.x, point.y);
}

const piece = (page: Page, square: string) => page.locator(`[data-testid="piece"][data-square="${square}"]`);

test('the 3D board starts with 40 pieces and remembers the choice', async ({ page }) => {
  await open3d(page);
  await expect(page.locator('[data-testid="piece"][data-color="light"]')).toHaveCount(20);
  await expect(page.locator('[data-testid="piece"][data-color="dark"]')).toHaveCount(20);

  await page.reload();
  await expect(page.getByTestId('board-3d-canvas')).toBeVisible({ timeout: 20_000 });
});

test('moves are played by tapping the 3D board', async ({ page }) => {
  await open3d(page);
  await tapCanvas(page, 'b4');
  await tapCanvas(page, 'a5');
  await expect(piece(page, 'a5')).toHaveAttribute('data-color', 'light');
  await expect(page.getByTestId('status')).toContainText('Dark to move.');
});

test('the 3D board can be played with the keyboard', async ({ page }) => {
  await open3d(page);
  await page.locator('button[data-square="d4"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('button[data-square="e5"]').focus();
  await page.keyboard.press('Enter');
  await expect(piece(page, 'e5')).toHaveAttribute('data-color', 'light');
  await expect(page.getByTestId('status')).toContainText('Dark to move.');
});

test('switching back to 2D keeps the position', async ({ page }) => {
  await open3d(page);
  await tapCanvas(page, 'b4');
  await tapCanvas(page, 'a5');
  await expect(page.getByTestId('status')).toContainText('Dark to move.');
  await page.getByRole('button', { name: '2D', exact: true }).click();
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
  await expect(page.getByTestId('status')).toContainText('Dark to move.');

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
