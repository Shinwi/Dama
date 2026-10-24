import { Browser, expect, Page, test } from '@playwright/test';
import { tap } from './start';

/** Each player gets their own browser context: separate storage, like two devices. */
async function player(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('group', { name: 'Opponent' }).getByRole('button', { name: 'Online' }).click();
  return page;
}

async function createRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Create room', exact: true }).last().click();
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z2-9]{4}$/);
  return (await code.textContent())!.trim();
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByRole('group', { name: 'Room' }).getByRole('button', { name: 'Join room' }).click();
  await page.getByTestId('room-code-input').fill(code);
  await page.getByRole('button', { name: 'Join room', exact: true }).last().click();
}

const piece = (page: Page, square: string, color: 'light' | 'dark') =>
  page.locator(`[data-testid="piece"][data-square="${square}"][data-color="${color}"]`);

test('two players in different browsers play each other through a room', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);
  await expect(white.getByTestId('status')).toContainText(`Waiting for your friend to join room ${code}`);

  const black = await player(browser);
  await joinRoom(black, code);
  await expect(black.getByTestId('room-code')).toHaveText(code);

  await expect(white.getByTestId('status')).toHaveText('Your move.');
  await expect(black.getByTestId('status')).toHaveText("Opponent's move.");

  await tap(white, 'b4', 'a5');
  await expect(piece(black, 'a5', 'light')).toBeVisible();
  await expect(black.getByTestId('status')).toHaveText('Your move.');

  await tap(black, 'c7', 'd6');
  await expect(piece(white, 'd6', 'dark')).toBeVisible();
  await expect(white.getByTestId('status')).toHaveText('Your move.');
});

test('a wrong room code is turned away on the home screen', async ({ browser }) => {
  const page = await player(browser);
  await joinRoom(page, 'ZZZZ');
  await expect(page.getByTestId('home-error')).toHaveText('No room with that code.');
});

test('a player who reloads the page is put back in the game', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);
  const black = await player(browser);
  await joinRoom(black, code);
  await tap(white, 'b4', 'a5');
  await expect(piece(black, 'a5', 'light')).toBeVisible();

  await black.reload();
  await expect(black.getByTestId('room-code')).toHaveText(code);
  await expect(piece(black, 'a5', 'light')).toBeVisible();
  await expect(black.getByTestId('status')).toHaveText('Your move.');
});

test('an invite link fills in the room code, and a reload after joining goes back to the game', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);

  const black = await (await browser.newContext()).newPage();
  await black.goto(`/?room=${code.toLowerCase()}`);
  await expect(black.getByTestId('room-code-input')).toHaveValue(code);
  await black.getByRole('button', { name: 'Join room', exact: true }).last().click();
  await expect(black.getByTestId('room-code')).toHaveText(code);
  expect(new URL(black.url()).search).toBe('');

  await black.reload();
  await expect(black.getByTestId('room-code')).toHaveText(code);
  await expect(black.getByTestId('status')).toHaveText("Opponent's move.");
});
