/** 1 = Light, -1 = Dark. Light moves first and sits at the bottom of the board. */
export type Side = 1 | -1;

export const LIGHT: Side = 1;
export const DARK: Side = -1;

/** Board cell contents: 0 empty, 1 light man, 2 light king, -1 dark man, -2 dark king. */
export type Cell = 0 | 1 | 2 | -1 | -2;

/** 100 cells, index = row * 10 + col. Row 0 = rank 1 (Light's home row), col 0 = file a. */
export type BoardArray = Int8Array;

export interface Move {
  from: number;
  to: number;
  /** Every square occupied during the move, in order, including `from` and `to`. */
  path: number[];
  /** Squares of captured enemy pieces, in the order they were jumped. Empty for a simple move. */
  captures: number[];
  /** True if any captured piece was a king. */
  capturedKing: boolean;
  /** The moving piece's value at `from`, before promotion. */
  piece: Cell;
  /** True if the piece becomes a king on this move (ends on the far row). */
  promotes: boolean;
}

export interface GameState {
  board: BoardArray;
  toMove: Side;
  strictMode: boolean;
  /** Consecutive moves (either side) with no capture and no man move — 50 reaches a draw. */
  quietMoves: number;
  /**
   * Pieces of the side that just moved which could have captured but didn't. The side to
   * move may take one of them off the board (nfikh) before playing its own move. Empty
   * unless the last move skipped an available capture.
   */
  forfeitable: number[];
}

/** One player's turn: an optional nfikh (the square of the piece taken), then a move. */
export interface Turn {
  nfikh: number | null;
  move: Move;
}

export type Outcome =
  | { kind: 'ongoing' }
  | { kind: 'win'; winner: Side }
  | { kind: 'draw' };
