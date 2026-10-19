import { describe, expect, it } from 'vitest';
import { chooseMove } from './ai';
import { boardFrom, createInitialBoard, mirrorBoard, parseSquare } from './board';
import { generateLegalMoves } from './moves';
import { Difficulty } from './ai';
import { LIGHT } from './types';

function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('chooseMove', () => {
  const difficulties: Difficulty[] = ['beginner', 'novice', 'very-good'];

  for (const difficulty of difficulties) {
    it(`${difficulty} always returns a legal move from the opening position`, () => {
      const board = createInitialBoard();
      const move = chooseMove(board, LIGHT, {
        difficulty,
        strictMode: false,
        rng: fixedRng([0.9, 0.1, 0.4, 0.6]),
        timeBudgetMs: 50,
      });
      const legal = generateLegalMoves(board, LIGHT, false);
      expect(move).not.toBeNull();
      expect(legal).toContainEqual(move);
    });
  }

  it('returns null when there is no legal move', () => {
    const board = boardFrom({ light: ['a9'], dark: ['b10'] });
    const move = chooseMove(board, LIGHT, { difficulty: 'beginner', strictMode: false });
    expect(move).toBeNull();
  });

  it('plays the only legal move immediately without consulting rng', () => {
    const board = boardFrom({ light: ['e5'], dark: ['d4'] });
    const move = chooseMove(board, LIGHT, {
      difficulty: 'very-good',
      strictMode: false,
      rng: () => {
        throw new Error('rng should not be called with a single legal move');
      },
    });
    expect(move?.captures).toHaveLength(1);
  });

  // Light has one man at e5. Moving it to d6 hangs it to Dark's c7 man
  // (c7xe5, capturing backwards, lands back on the now-empty e5). Moving to
  // f6 is safe. A sound engine must not choose the losing move, in this
  // position or its left-right mirror (so an asymmetric direction bug can't
  // pass by luck).
  for (const difficulty of ['novice', 'very-good'] as Difficulty[]) {
    it(`${difficulty} does not hang its only piece`, () => {
      const board = boardFrom({ light: ['e5'], dark: ['c7'] });
      const move = chooseMove(board, LIGHT, { difficulty, strictMode: false, timeBudgetMs: 200 });
      expect(move?.to).toBe(parseSquare('f6'));
    });

    it(`${difficulty} does not hang its only piece (mirrored position)`, () => {
      // Mirroring flips files: e5/c7 -> f5/h7, and the safe target f6 -> e6.
      const board = mirrorBoard(boardFrom({ light: ['e5'], dark: ['c7'] }));
      const move = chooseMove(board, LIGHT, { difficulty, strictMode: false, timeBudgetMs: 200 });
      expect(move?.to).toBe(parseSquare('e6'));
    });
  }

  // Flying kings make each extra search depth very expensive: before the clock was checked
  // inside the search, this position took ~1.7s against a 300ms budget.
  it('very-good stays close to its time budget, even with many kings', () => {
    const board = boardFrom({
      lightKings: ['a1', 'c1', 'e1', 'g1'],
      darkKings: ['b10', 'd10', 'f10', 'h10'],
    });
    const start = Date.now();
    const move = chooseMove(board, LIGHT, {
      difficulty: 'very-good',
      strictMode: false,
      timeBudgetMs: 300,
    });
    const elapsed = Date.now() - start;

    expect(generateLegalMoves(board, LIGHT, false)).toContainEqual(move);
    expect(elapsed).toBeLessThan(450);
  });

  it('very-good still searches past depth 1 when there is time', () => {
    // With a generous budget it must find the safe move that needs a deeper look (see above).
    const board = boardFrom({ light: ['e5'], dark: ['c7'] });
    const move = chooseMove(board, LIGHT, {
      difficulty: 'very-good',
      strictMode: false,
      timeBudgetMs: 1000,
    });
    expect(move?.to).toBe(parseSquare('f6'));
  });
});
