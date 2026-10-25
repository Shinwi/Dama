import { describe, expect, it } from 'vitest';
import { chooseTurn } from './ai';
import { boardFrom, parseSquare, squareName } from './board';
import { advanceState, legalMoves, outcome, takeForfeit } from './game';
import { moveNotation } from './moves';
import { DARK, GameState, LIGHT, Side } from './types';

function stateAt(pieces: Parameters<typeof boardFrom>[0], toMove: Side = LIGHT): GameState {
  return { board: boardFrom(pieces), toMove, strictMode: false, quietMoves: 0, forfeitable: [], timeouts: { light: 0, dark: 0 } };
}

function play(state: GameState, notation: string): GameState {
  const move = legalMoves(state).find((m) => moveNotation(m) === notation);
  if (!move) throw new Error(`no move ${notation}`);
  return advanceState(state, move);
}

const names = (squares: number[]) => squares.map(squareName).sort();

describe('nfikh', () => {
  // Light c3 can take d4 (c3xe5); Dark j10 is just somewhere to move.
  const missable = { light: ['c3', 'a1'], dark: ['d4', 'j10'] };

  it('a capture skipped leaves the piece that could have captured forfeitable', () => {
    const next = play(stateAt(missable), 'a1-b2');
    expect(next.toMove).toBe(DARK);
    expect(names(next.forfeitable)).toEqual(['c3']);
  });

  it('counts the piece that could have captured on the square it moved to', () => {
    const next = play(stateAt(missable), 'c3-b4');
    expect(names(next.forfeitable)).toEqual(['b4']);
  });

  it('every piece that could have captured is forfeitable', () => {
    // c3 can take d4, g3 can take h4.
    const next = play(stateAt({ light: ['c3', 'g3', 'a1'], dark: ['d4', 'h4'] }), 'a1-b2');
    expect(names(next.forfeitable)).toEqual(['c3', 'g3']);
  });

  it('nothing is forfeitable after a capture, or when no capture was available', () => {
    expect(play(stateAt(missable), 'c3xe5').forfeitable).toEqual([]);
    expect(play(stateAt({ light: ['a1'], dark: ['j10'] }), 'a1-b2').forfeitable).toEqual([]);
  });

  it('taking a piece removes it and it is still the same side to move', () => {
    const afterMiss = play(stateAt(missable), 'a1-b2');
    const afterNfikh = takeForfeit(afterMiss, parseSquare('c3'));
    expect(afterNfikh.board[parseSquare('c3')]).toBe(0);
    expect(afterNfikh.toMove).toBe(DARK);
    expect(afterNfikh.forfeitable).toEqual([]);
    expect(afterNfikh.quietMoves).toBe(0);
  });

  it('only a forfeitable piece can be taken', () => {
    const afterMiss = play(stateAt(missable), 'a1-b2');
    expect(takeForfeit(afterMiss, parseSquare('b2'))).toBe(afterMiss);
  });

  it('the chance is gone once the side to move plays a move instead', () => {
    const afterMiss = play(stateAt(missable), 'a1-b2');
    const afterReply = play(afterMiss, 'j10-i9');
    expect(afterReply.forfeitable).toEqual([]);
  });

  it('a side with no move is not lost while taking a piece by nfikh would free one', () => {
    // Light a9 is blocked by Dark b10, which (say) skipped a capture last move.
    const blocked: GameState = { ...stateAt({ light: ['a9'], dark: ['b10'] }), forfeitable: [parseSquare('b10')] };
    expect(outcome(blocked).kind).toBe('ongoing');
    expect(outcome({ ...blocked, forfeitable: [] })).toEqual({ kind: 'win', winner: DARK });
  });
});

describe('chooseTurn and nfikh', () => {
  it('takes a free piece by nfikh', () => {
    // Dark skipped a capture with h6; Light takes it, then moves.
    const board = boardFrom({ light: ['a1', 'c1'], dark: ['h6', 'j10'] });
    for (const difficulty of ['novice', 'very-good'] as const) {
      const turn = chooseTurn(board, LIGHT, [parseSquare('h6')], { difficulty, strictMode: false, timeBudgetMs: 100 });
      expect(turn?.nfikh).toBe(parseSquare('h6'));
    }
  });

  it('never takes a piece that is not forfeitable', () => {
    const board = boardFrom({ light: ['a1', 'c1'], dark: ['h6', 'j10'] });
    const turn = chooseTurn(board, LIGHT, [], { difficulty: 'very-good', strictMode: false, timeBudgetMs: 50 });
    expect(turn?.nfikh).toBeNull();
  });
});
