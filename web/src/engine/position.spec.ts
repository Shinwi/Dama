import { describe, expect, it } from 'vitest';
import rulesCases from './rules-cases.json';
import { boardFrom, createEmptyBoard, parseSquare } from './board';
import { createInitialState, legalMoves, outcome } from './game';
import { sortedNotations } from './moves';
import { decodePosition, encodePosition, normalizeCell, validatePosition } from './position';
import { DARK, GameState, LIGHT, Side } from './types';

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

function decodeOk(code: string, strictMode = false): GameState {
  const result = decodePosition(code, strictMode);
  if (!result.ok) throw new Error(`Expected "${code}" to decode, got: ${result.errors.join('; ')}`);
  return result.state;
}

function decodeErrors(code: string): string[] {
  const result = decodePosition(code);
  if (result.ok) throw new Error(`Expected "${code}" to be rejected`);
  return result.errors;
}

describe('decodePosition', () => {
  it('reads the example from the issue', () => {
    const state = decodeOk('L:b4,c3,Ke5;D:f6,g7,Kh8;t:L;q:0');
    expect(state.board).toEqual(
      boardFrom({ light: ['b4', 'c3'], lightKings: ['e5'], dark: ['f6', 'g7'], darkKings: ['h8'] }),
    );
    expect(state.toMove).toBe(LIGHT);
    expect(state.quietMoves).toBe(0);
    expect(state.strictMode).toBe(false);
  });

  it('defaults to Light to move and zero quiet moves', () => {
    const state = decodeOk('L:c3;D:f6');
    expect(state.toMove).toBe(LIGHT);
    expect(state.quietMoves).toBe(0);
  });

  it('reads Dark to move and a quiet-move count', () => {
    const state = decodeOk('L:Kc3;D:Kf6;t:D;q:48');
    expect(state.toMove).toBe(DARK);
    expect(state.quietMoves).toBe(48);
  });

  it('takes strict mode from the caller, not the code', () => {
    expect(decodeOk('L:c3;D:f6', true).strictMode).toBe(true);
  });

  it('tolerates whitespace, letter case and section order', () => {
    const tidy = decodeOk('L:b4,Ke5;D:f6;t:D');
    const messy = decodeOk('  t : d ;\n d: F6 ; l : B4 , kE5 ; ');
    expect(messy.board).toEqual(tidy.board);
    expect(messy.toMove).toBe(tidy.toMove);
  });

  it('accepts empty sections and missing sides', () => {
    expect(decodeOk('L:;D:f6').board).toEqual(boardFrom({ dark: ['f6'] }));
    expect(decodeOk('D:f6').board).toEqual(boardFrom({ dark: ['f6'] }));
    expect(decodeOk('').board).toEqual(createEmptyBoard());
  });

  it('reads rank 10 squares', () => {
    expect(decodeOk('D:j10').board[parseSquare('j10')]).toBe(-1);
  });

  it('accepts a position where the side to move has no moves (a finished game)', () => {
    const state = decodeOk('L:c3;t:D');
    expect(outcome(state)).toEqual({ kind: 'win', winner: LIGHT });
  });

  it('accepts a quiet-move count at the draw limit (a drawn game)', () => {
    const state = decodeOk('L:Kc3;D:Kh8;q:50');
    expect(outcome(state)).toEqual({ kind: 'draw' });
  });
});

describe('promotion row', () => {
  it('turns a light man on rank 10 into a king', () => {
    expect(decodeOk('L:b10').board[parseSquare('b10')]).toBe(2);
  });

  it('turns a dark man on rank 1 into a king', () => {
    expect(decodeOk('D:a1').board[parseSquare('a1')]).toBe(-2);
  });

  it('leaves men on their own home row as men', () => {
    const state = decodeOk('L:a1;D:b10');
    expect(state.board[parseSquare('a1')]).toBe(1);
    expect(state.board[parseSquare('b10')]).toBe(-1);
  });

  it('normalizeCell only changes men on their far row', () => {
    expect(normalizeCell(parseSquare('d10'), 1)).toBe(2);
    expect(normalizeCell(parseSquare('c1'), -1)).toBe(-2);
    expect(normalizeCell(parseSquare('e9'), 1)).toBe(1);
    expect(normalizeCell(parseSquare('d10'), 2)).toBe(2);
    expect(normalizeCell(parseSquare('d10'), 0)).toBe(0);
  });

  it('encodes the normalized code, with the K added', () => {
    expect(encodePosition(decodeOk('L:b10;D:a1'))).toBe('L:Kb10;D:Ka1;t:L');
  });
});

describe('decodePosition errors', () => {
  it('rejects a piece on a non-playable square', () => {
    expect(decodeErrors('L:b1')).toEqual(['b1 is not a playable square']);
  });

  it('rejects a square listed twice, within or across sides', () => {
    expect(decodeErrors('L:c3,c3')).toEqual(['c3 is listed more than once']);
    expect(decodeErrors('L:c3;D:Kc3')).toEqual(['c3 is listed more than once']);
  });

  it('rejects more than 20 pieces for one side', () => {
    const lightStart = encodePosition(createInitialState()).split(';')[0];
    expect(decodeErrors(`${lightStart},a5`)).toEqual(['Light has 21 pieces (max 20)']);
  });

  it('rejects unknown or malformed squares', () => {
    expect(decodeErrors('L:k3')).toEqual(['"k3" is not a square (a1–j10)']);
    expect(decodeErrors('L:a11')).toEqual(['"a11" is not a square (a1–j10)']);
    expect(decodeErrors('L:c3x')).toEqual(['"c3x" is not a square (a1–j10)']);
    expect(decodeErrors('L:a0')).toEqual(['"a0" is not a square (a1–j10)']);
  });

  it('rejects bad side-to-move and quiet-move values', () => {
    expect(decodeErrors('L:c3;t:X')).toEqual(['"t:X" must be L or D']);
    expect(decodeErrors('L:c3;q:-1')).toEqual(['"q:-1" must be a whole number ≥ 0']);
    expect(decodeErrors('L:c3;q:abc')).toEqual(['"q:abc" must be a whole number ≥ 0']);
  });

  it('rejects unknown, repeated or colon-less sections', () => {
    expect(decodeErrors('L:c3;X:1')).toEqual(['Unknown section "X:"']);
    expect(decodeErrors('L:c3;l:e5')).toEqual(['"L:" appears more than once']);
    expect(decodeErrors('L:c3;oops')).toEqual(['"oops" is missing a \':\'']);
  });

  it('collects every problem instead of stopping at the first', () => {
    expect(decodeErrors('L:b1,zz;t:X')).toHaveLength(3);
  });
});

describe('encodePosition', () => {
  it('writes pieces in square order, t always, q only when non-zero', () => {
    const board = boardFrom({
      light: ['c3', 'b4'],
      lightKings: ['e5'],
      dark: ['g7', 'f6'],
      darkKings: ['h8'],
    });
    expect(encodePosition({ board, toMove: LIGHT, quietMoves: 0 })).toBe(
      'L:c3,b4,Ke5;D:f6,g7,Kh8;t:L',
    );
    expect(encodePosition({ board, toMove: DARK, quietMoves: 7 })).toBe(
      'L:c3,b4,Ke5;D:f6,g7,Kh8;t:D;q:7',
    );
  });

  it('writes an empty board', () => {
    expect(encodePosition({ board: createEmptyBoard(), toMove: LIGHT, quietMoves: 0 })).toBe(
      'L:;D:;t:L',
    );
  });

  it('round-trips the opening position', () => {
    const initial = createInitialState();
    const state = decodeOk(encodePosition(initial));
    expect(state.board).toEqual(initial.board);
    expect(state.toMove).toBe(LIGHT);
  });
});

describe('round trip over rules-cases.json', () => {
  for (const testCase of rulesCases as RuleCase[]) {
    it(testCase.name, () => {
      const side: Side = testCase.toMove === 'light' ? LIGHT : DARK;
      const strictMode = testCase.strictMode ?? false;
      const board = boardFrom(testCase);
      const code = encodePosition({ board, toMove: side, quietMoves: 0 });

      const state = decodeOk(code, strictMode);
      expect(state.board).toEqual(board);
      expect(state.toMove).toBe(side);
      expect(encodePosition(state)).toBe(code);
      // The decoded position plays exactly like the original fixture.
      expect(sortedNotations(legalMoves(state))).toEqual([...testCase.expected].sort());
    });
  }
});

describe('validatePosition', () => {
  it('accepts the opening position', () => {
    expect(validatePosition(createInitialState())).toEqual([]);
  });

  it('flags a raw board with an unpromoted man on its far row', () => {
    const board = createEmptyBoard();
    board[parseSquare('b10')] = 1;
    expect(validatePosition({ board, toMove: LIGHT, quietMoves: 0 })).toEqual([
      "b10: a man can't stand on its own promotion row",
    ]);
  });

  it('flags a negative or fractional quiet-move count', () => {
    const board = boardFrom({ light: ['c3'] });
    expect(validatePosition({ board, toMove: LIGHT, quietMoves: -1 })).toHaveLength(1);
    expect(validatePosition({ board, toMove: LIGHT, quietMoves: 1.5 })).toHaveLength(1);
  });
});
