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

// Nothing listens on this port, so these pages find no online server.
const NO_SERVER = 'server=http://localhost:3999';

test('with no online server, the home screen has no Online option', async ({ page }) => {
  await page.goto(`/?${NO_SERVER}`);
  const opponent = page.getByRole('group', { name: 'Opponent' });
  await expect(opponent.getByRole('button', { name: 'Vs computer' })).toBeVisible();
  // Give the check time to give up (2 s), then make sure the button never appeared.
  await page.waitForTimeout(2500);
  await expect(opponent.getByRole('button', { name: 'Online' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeVisible();
});

test('an invite link with no online server says online games are unavailable', async ({ page }) => {
  await page.goto(`/?room=K7QX&${NO_SERVER}`);
  await expect(page.getByTestId('online-unavailable')).toContainText("Online games aren't available right now.");
  await expect(page.getByTestId('room-code-input')).toHaveCount(0);
});

// Issue #36: a phone loses its connection (screen locked, app switched, signal gone) and the
// page doesn't know yet. A move made then must still reach the opponent once it's back.
test('a move made while the connection is down reaches the opponent once it is back', async ({ browser }) => {
  test.setTimeout(90_000); // noticing a dead connection takes up to ~20 s (the heartbeat)
  const white = await player(browser);
  const code = await createRoom(white);
  const blackContext = await browser.newContext();
  const black = await blackContext.newPage();
  await black.goto('/');
  await black.getByRole('group', { name: 'Opponent' }).getByRole('button', { name: 'Online' }).click();
  await joinRoom(black, code);
  await tap(white, 'b4', 'a5');
  await expect(piece(black, 'a5', 'light')).toBeVisible();

  await blackContext.setOffline(true);
  await tap(black, 'c7', 'd6');
  await expect(piece(black, 'd6', 'dark')).toBeVisible(); // shown at once, as always
  // White's page finds out Black is gone (the server's heartbeat).
  await expect(white.getByTestId('status')).toHaveText(/Your opponent lost connection/, { timeout: 40_000 });

  await blackContext.setOffline(false);
  await expect(piece(white, 'd6', 'dark')).toBeVisible({ timeout: 40_000 });
  await expect(white.getByTestId('status')).toHaveText('Your move.');
  await expect(black.getByTestId('status')).toHaveText("Opponent's move.");
  await expect(piece(black, 'd6', 'dark')).toBeVisible(); // never jumped back
  await expect(black.getByTestId('online-error')).toHaveCount(0);
});

// Issue #39: closing Safari mid-game empties the tab's storage. Closing the page and opening
// a new one in the same browser profile is the same thing (localStorage stays, sessionStorage
// goes).
test('a player who closes the browser mid-game is put back in the game on opening it again', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);
  const blackContext = await browser.newContext();
  const black = await blackContext.newPage();
  await black.goto('/');
  await black.getByRole('group', { name: 'Opponent' }).getByRole('button', { name: 'Online' }).click();
  await joinRoom(black, code);
  await tap(white, 'b4', 'a5');
  await expect(piece(black, 'a5', 'light')).toBeVisible();

  await black.close();
  await expect(white.getByTestId('status')).toHaveText(/Your opponent lost connection/);

  const reopened = await blackContext.newPage();
  await reopened.goto('/');
  await expect(reopened.getByTestId('room-code')).toHaveText(code);
  await expect(piece(reopened, 'a5', 'light')).toBeVisible();
  await expect(reopened.getByTestId('status')).toHaveText('Your move.');
  await expect(white.getByTestId('status')).toHaveText("Opponent's move.");
});

test('joining your own room with its code takes your seat back; a third player is turned away', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);
  const blackContext = await browser.newContext();
  const black = await blackContext.newPage();
  await black.goto('/');
  await black.getByRole('group', { name: 'Opponent' }).getByRole('button', { name: 'Online' }).click();
  await joinRoom(black, code);
  await expect(white.getByTestId('status')).toHaveText('Your move.');

  // Black leaves, then types the code in again.
  await black.getByRole('button', { name: 'Leave room' }).click();
  await black.getByRole('group', { name: 'Opponent' }).getByRole('button', { name: 'Online' }).click();
  await joinRoom(black, code);
  await expect(black.getByTestId('room-code')).toHaveText(code);
  await expect(black.getByTestId('status')).toHaveText("Opponent's move.");
  await expect(white.getByTestId('status')).toHaveText('Your move.');

  const stranger = await player(browser);
  await joinRoom(stranger, code);
  await expect(stranger.getByTestId('home-error')).toHaveText(
    'That room already has two players. If one of them is you, open the game on the device you started it on.',
  );
});

test('each browser sends its own anonymous player ID, and the server counts the players', async ({ browser }) => {
  const white = await player(browser);
  const code = await createRoom(white);
  const black = await player(browser);
  await joinRoom(black, code);
  await expect(white.getByTestId('status')).toHaveText('Your move.');

  const idOf = (page: Page) => page.evaluate(() => localStorage.getItem('dama.player.v1'));
  const [whiteId, blackId] = [await idOf(white), await idOf(black)];
  expect(whiteId).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  expect(blackId).not.toBe(whiteId);

  // Other tests share this server, so at least these two.
  const stats = await (await fetch('http://localhost:3000/stats.json')).json();
  expect(stats.today.uniquePlayers).toBeGreaterThanOrEqual(2);
  expect(stats.now.roomsActive).toBeGreaterThanOrEqual(1);
});
