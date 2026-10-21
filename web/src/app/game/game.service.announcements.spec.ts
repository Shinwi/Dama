import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare } from '../../engine/board';
import { generateLegalMoves } from '../../engine/moves';
import { DARK, LIGHT, Move } from '../../engine/types';
import { defaultSettings } from './game-controller';
import { describeMove, GameService } from './game.service';

function move(pieces: Parameters<typeof boardFrom>[0], side: typeof LIGHT | typeof DARK, to: string): Move {
  const found = generateLegalMoves(boardFrom(pieces), side, false).find((m) => m.to === parseSquare(to));
  if (!found) throw new Error(`no move to ${to}`);
  return found;
}

describe('describeMove', () => {
  const vsComputer = { ...defaultSettings(), mode: 'computer' as const, playerSide: LIGHT };

  it('says "You" for the player and "Computer" for the computer', () => {
    expect(describeMove(move({ light: ['b4'] }, LIGHT, 'a5'), vsComputer)).toBe('You played b4 to a5.');
    expect(describeMove(move({ dark: ['c7'] }, DARK, 'b6'), vsComputer)).toBe('Computer played c7 to b6.');
  });

  it('spells out a multi-jump and how many it took', () => {
    const chain = move({ light: ['c5'], dark: ['d6', 'd8'] }, LIGHT, 'c9');
    expect(describeMove(chain, vsComputer)).toBe('You played c5 takes e7 takes c9, 2 pieces captured.');
  });

  it('mentions a captured king and a promotion', () => {
    const kingTaken = move({ light: ['g7'], darkKings: ['h8'] }, LIGHT, 'i9');
    expect(describeMove(kingTaken, vsComputer)).toBe('You played g7 takes i9, a king captured.');

    const toLastRow = move({ light: ['b9'] }, LIGHT, 'a10');
    expect(describeMove(toLastRow, vsComputer)).toBe('You played b9 to a10, promoted to king.');
  });

  it('names the side in 1v1', () => {
    const pvp = { ...defaultSettings(), mode: 'pvp' as const };
    expect(describeMove(move({ dark: ['c7'] }, DARK, 'b6'), pvp)).toBe('Dark played c7 to b6.');
  });
});

describe('GameService announcements', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(GameService);
    // The test plays the moves itself; the computer answers at once, with no move.
    (service as unknown as { ai: unknown }).ai = { chooseMove: async () => null };
  });

  it('announces the player move, then Undo and New game', async () => {
    service.tapSquare(parseSquare('b4'));
    service.tapSquare(parseSquare('a5'));
    TestBed.tick();
    expect(service.announcement()).toBe('You played b4 to a5.');

    service.boardSettled();
    await new Promise((resolve) => setTimeout(resolve));
    service.undo();
    expect(service.announcement()).toBe('Your last move was taken back.');

    service.newGame();
    expect(service.announcement()).toBe('New game.');
  });
});
