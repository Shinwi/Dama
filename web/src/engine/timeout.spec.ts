import { describe, expect, it } from 'vitest';
import { parseSquare } from './board';
import { advanceState, createInitialState, legalMoves, MAX_TIMEOUTS, outcome, passTurn } from './game';
import { DARK, GameState } from './types';

const play = (state: GameState, from: string, to: string): GameState => {
  const move = legalMoves(state).find((m) => m.from === parseSquare(from) && m.to === parseSquare(to));
  if (!move) throw new Error(`no move ${from}-${to}`);
  return advanceState(state, move);
};

describe('passTurn (the move timer ran out)', () => {
  it('skips the turn: the other side moves, the board stays as it was', () => {
    const start = createInitialState();
    const passed = passTurn(start);
    expect(passed.toMove).toBe(DARK);
    expect(Array.from(passed.board)).toEqual(Array.from(start.board));
    expect(passed.timeouts).toEqual({ light: 1, dark: 0 });
  });

  it('does not count toward the 50-quiet-move draw', () => {
    const state = { ...createInitialState(), quietMoves: 12 };
    expect(passTurn(state).quietMoves).toBe(12);
  });

  it('ends the chance to take a piece by nfikh', () => {
    const state = { ...createInitialState(), forfeitable: [parseSquare('b4')] };
    expect(passTurn(state).forfeitable).toEqual([]);
  });

  it(`loses the game after ${MAX_TIMEOUTS} time-outs in a row`, () => {
    let state = createInitialState();
    for (let i = 0; i < MAX_TIMEOUTS - 1; i++) {
      state = passTurn(state); // White runs out of time
      expect(outcome(state)).toEqual({ kind: 'ongoing' });
      state = play(state, i === 0 ? 'c7' : 'b6', i === 0 ? 'b6' : 'a5'); // Black moves
    }
    state = passTurn(state);
    expect(outcome(state)).toEqual({ kind: 'win', winner: DARK, onTime: true });
  });

  it('a move ends the run of time-outs', () => {
    let state = passTurn(passTurn(createInitialState())); // White, then Black, out of time
    expect(state.timeouts).toEqual({ light: 1, dark: 1 });
    state = play(state, 'b4', 'a5');
    expect(state.timeouts).toEqual({ light: 0, dark: 1 });
    expect(state.toMove).toBe(DARK);
  });
});
