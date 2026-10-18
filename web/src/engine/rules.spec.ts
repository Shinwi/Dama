import { describe, expect, it } from 'vitest';
import rulesCases from './rules-cases.json';
import { boardFrom, createInitialBoard, isPlayableSquare, rowOf, colOf, parseSquare } from './board';
import { applyMove, generateLegalMoves, sortedNotations } from './moves';
import { DARK, LIGHT, Side } from './types';

interface RuleCase {
  name: string;
  light?: string[];
  dark?: string[];
  lightKings?: string[];
  darkKings?: string[];
  toMove: 'light' | 'dark';
  strictMode?: boolean;
  expected: string[];
}

describe('rules-cases.json', () => {
  for (const testCase of rulesCases as RuleCase[]) {
    it(testCase.name, () => {
      const board = boardFrom(testCase);
      const side: Side = testCase.toMove === 'light' ? LIGHT : DARK;
      const moves = generateLegalMoves(board, side, testCase.strictMode ?? false);
      expect(sortedNotations(moves)).toEqual([...testCase.expected].sort());
    });
  }
});

describe('opening position', () => {
  it('gives Light 9 legal moves', () => {
    expect(generateLegalMoves(createInitialBoard(), LIGHT, false)).toHaveLength(9);
  });

  it('gives Dark 9 legal moves', () => {
    expect(generateLegalMoves(createInitialBoard(), DARK, false)).toHaveLength(9);
  });
});

describe('promotion', () => {
  it('promotes a light man that ends its move on rank 10', () => {
    const board = boardFrom({ light: ['e9'] });
    const moves = generateLegalMoves(board, LIGHT, false);
    const toF10 = moves.find((m) => m.to === parseSquare('f10'));
    expect(toF10?.promotes).toBe(true);
    const next = applyMove(board, toF10!);
    expect(next[parseSquare('f10')]).toBe(2);
  });

  it('promotes a dark man that ends its move on rank 1', () => {
    const board = boardFrom({ dark: ['e2'] });
    const moves = generateLegalMoves(board, DARK, false);
    const toF1 = moves.find((m) => m.to === parseSquare('f1'));
    expect(toF1?.promotes).toBe(true);
    const next = applyMove(board, toF1!);
    expect(next[parseSquare('f1')]).toBe(-2);
  });

  it('does not promote a man only passing through the far row', () => {
    const board = boardFrom({ light: ['d8'], dark: ['e9', 'g9'] });
    const [move] = generateLegalMoves(board, LIGHT, false);
    expect(move.promotes).toBe(false);
    const next = applyMove(board, move);
    expect(next[parseSquare('h8')]).toBe(1);
  });
});

describe('capturedKing', () => {
  it('is false for a move that captures nothing', () => {
    const [move] = generateLegalMoves(boardFrom({ light: ['e5'] }), LIGHT, false);
    expect(move.capturedKing).toBe(false);
  });

  it('is false when the captured piece is a man', () => {
    const [move] = generateLegalMoves(boardFrom({ light: ['c3'], dark: ['d4'] }), LIGHT, false);
    expect(move.capturedKing).toBe(false);
  });

  it('is true when the captured piece is a king', () => {
    const [move] = generateLegalMoves(boardFrom({ light: ['c3'], darkKings: ['d4'] }), LIGHT, false);
    expect(move.capturedKing).toBe(true);
  });

  it('is true if any piece in a multi-jump is a king, even if not the first', () => {
    const [move] = generateLegalMoves(
      boardFrom({ light: ['c3'], dark: ['d4'], darkKings: ['f6'] }),
      LIGHT,
      false,
    );
    expect(move.captures.length).toBe(2);
    expect(move.capturedKing).toBe(true);
  });
});

describe('applyMove', () => {
  it('removes all captured pieces at once and does not mutate its input', () => {
    const board = boardFrom({ light: ['c3'], dark: ['d4', 'f6'] });
    const before = board.slice();
    const [move] = generateLegalMoves(board, LIGHT, false);
    const next = applyMove(board, move);

    expect(board).toEqual(before);
    expect(next[parseSquare('d4')]).toBe(0);
    expect(next[parseSquare('f6')]).toBe(0);
    expect(next[parseSquare('g7')]).toBe(1);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('seeded random games', () => {
  it('keeps board invariants across 300 random games', () => {
    // 300 games x up to 400 plies of move generation is deliberately thorough; give it room.
    for (let seed = 0; seed < 300; seed++) {
      const rng = mulberry32(seed + 1);
      let board = createInitialBoard();
      let side: Side = LIGHT;
      const seenCapturedTwice = new Set<string>();

      for (let ply = 0; ply < 400; ply++) {
        const moves = generateLegalMoves(board, side, false);
        if (moves.length === 0) break;

        const move = moves[Math.floor(rng() * moves.length)];
        const capturedSet = new Set(move.captures);
        expect(capturedSet.size).toBe(move.captures.length);

        const piecesBefore = countPieces(board);
        board = applyMove(board, move);
        const piecesAfter = countPieces(board);
        expect(piecesBefore - piecesAfter).toBe(move.captures.length);

        for (let square = 0; square < board.length; square++) {
          if (board[square] !== 0) {
            expect(isPlayableSquare(rowOf(square), colOf(square))).toBe(true);
          }
        }

        side = (-side) as Side;
      }

      expect(seenCapturedTwice.size).toBe(0);
    }
  }, 60_000);
});

function countPieces(board: Int8Array): number {
  let count = 0;
  for (const cell of board) if (cell !== 0) count++;
  return count;
}
