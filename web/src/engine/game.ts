import { createInitialBoard, isKing } from './board';
import { applyMove, forfeitableAfter, generateLegalMoves, removePiece } from './moves';
import { DARK, GameState, LIGHT, Move, Outcome, Side } from './types';

export const DRAW_QUIET_MOVES = 50;

export function createInitialState(strictMode = false): GameState {
  return {
    board: createInitialBoard(),
    toMove: LIGHT,
    strictMode,
    quietMoves: 0,
    forfeitable: [],
  };
}

export function legalMoves(state: GameState): Move[] {
  return generateLegalMoves(state.board, state.toMove, state.strictMode);
}

/** Applies a move and returns the next state. Does not mutate `state`. */
export function advanceState(state: GameState, move: Move): GameState {
  const board = applyMove(state.board, move);
  const wasQuiet = move.captures.length === 0 && isKing(move.piece);
  return {
    board,
    toMove: (-state.toMove) as Side,
    strictMode: state.strictMode,
    quietMoves: wasQuiet ? state.quietMoves + 1 : 0,
    forfeitable: forfeitableAfter(state.board, move),
  };
}

/**
 * Nfikh: the side to move takes one of the opponent's pieces that skipped a capture off the
 * board. It's still the same side's turn afterwards — they now play a normal move — and the
 * chance to take another is gone. Returns `state` unchanged if `square` isn't forfeitable.
 */
export function takeForfeit(state: GameState, square: number): GameState {
  if (!state.forfeitable.includes(square)) return state;
  return {
    ...state,
    board: removePiece(state.board, square),
    quietMoves: 0,
    forfeitable: [],
  };
}

export function outcome(state: GameState): Outcome {
  if (state.quietMoves >= DRAW_QUIET_MOVES) {
    return { kind: 'draw' };
  }
  // A side with no move may still have one after taking a piece by nfikh (that piece may have
  // been the one blocking it).
  const canMove =
    legalMoves(state).length > 0 ||
    state.forfeitable.some((square) => legalMoves(takeForfeit(state, square)).length > 0);
  if (!canMove) {
    return { kind: 'win', winner: (-state.toMove) as Side };
  }
  return { kind: 'ongoing' };
}

export function pieceCounts(state: GameState): { light: number; dark: number } {
  let light = 0;
  let dark = 0;
  for (const cell of state.board) {
    if (cell > 0) light++;
    else if (cell < 0) dark++;
  }
  return { light, dark };
}

export { LIGHT, DARK };
export type { Side };
