import { Page } from '@playwright/test';

export interface Setup {
  mode?: 'Vs computer' | '1v1';
  difficulty?: 'Beginner' | 'Novice' | 'Very good';
  side?: 'White' | 'Black';
  board?: 'Classic' | 'Wood' | 'Green';
}

/**
 * The home screen's options, found by their data attributes rather than their wording, so
 * the tests work whatever each design calls them.
 */
export const home = {
  mode: (page: Page, mode: 'computer' | 'pvp' | 'online' | 'match') => page.locator(`[data-mode="${mode}"]`),
  entry: (page: Page, entry: 'create' | 'join') => page.locator(`[data-entry="${entry}"]`),
  start: (page: Page) => page.getByTestId('start'),
};

const MODES = { 'Vs computer': 'computer', '1v1': 'pvp' } as const;
const DIFFICULTIES = { Beginner: 'beginner', Novice: 'novice', 'Very good': 'very-good' } as const;

/** Opens the app and starts a game from the home screen. */
export async function startGame(page: Page, setup: Setup = {}): Promise<void> {
  await page.goto('/');
  if (setup.mode) await home.mode(page, MODES[setup.mode]).click();
  if (setup.difficulty) await page.locator(`[data-difficulty="${DIFFICULTIES[setup.difficulty]}"]`).click();
  if (setup.side) await page.locator(`[data-side="${setup.side.toLowerCase()}"]`).click();
  if (setup.board) await page.locator(`[data-theme="${setup.board.toLowerCase()}"]`).click();
  await home.start(page).click();
}

/** Taps squares in order, e.g. tap(page, 'b4', 'a5') plays b4-a5. */
export async function tap(page: Page, ...squares: string[]): Promise<void> {
  for (const square of squares) await page.locator(`button[data-square="${square}"]`).click();
}
