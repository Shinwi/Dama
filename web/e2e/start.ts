import { Page } from '@playwright/test';

export interface Setup {
  mode?: 'Vs computer' | '1v1';
  difficulty?: 'Beginner' | 'Novice' | 'Very good';
  side?: 'White' | 'Black';
  board?: 'Classic' | 'Wood' | 'Green';
}

/** Opens the app and starts a game from the home screen. */
export async function startGame(page: Page, setup: Setup = {}): Promise<void> {
  await page.goto('/');
  const group = (name: string) => page.getByRole('group', { name });
  if (setup.mode) await group('Opponent').getByRole('button', { name: setup.mode, exact: true }).click();
  if (setup.difficulty) await group('Difficulty').getByRole('button', { name: setup.difficulty, exact: true }).click();
  if (setup.side) await group('Play as').getByRole('button', { name: setup.side, exact: true }).click();
  if (setup.board) await group('Board pattern').getByRole('button', { name: setup.board, exact: true }).click();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
}

/** Taps squares in order, e.g. tap(page, 'b4', 'a5') plays b4-a5. */
export async function tap(page: Page, ...squares: string[]): Promise<void> {
  for (const square of squares) await page.locator(`button[data-square="${square}"]`).click();
}
