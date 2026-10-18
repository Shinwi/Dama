import { isOnBoard, isKing, rowOf, colOf, squareIndex, squareName } from './board';
import { BoardArray, Cell, LIGHT, Move, Side } from './types';

type Dir = readonly [number, number];

const ALL_DIAGONALS: readonly Dir[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function forwardDirs(side: Side): readonly Dir[] {
  return side === LIGHT ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];
}

function farRow(side: Side): number {
  return side === LIGHT ? 9 : 0;
}

interface Hop {
  to: number;
  captured: number;
}

/** One-hop captures available from `square`, given pieces already captured this turn. */
function captureHops(
  board: BoardArray,
  square: number,
  side: Side,
  pieceIsKing: boolean,
  capturedSet: ReadonlySet<number>,
): Hop[] {
  const hops: Hop[] = [];
  const row = rowOf(square);
  const col = colOf(square);

  for (const [dr, dc] of ALL_DIAGONALS) {
    if (!pieceIsKing) {
      const enemyRow = row + dr;
      const enemyCol = col + dc;
      const landRow = row + 2 * dr;
      const landCol = col + 2 * dc;
      if (!isOnBoard(enemyRow, enemyCol) || !isOnBoard(landRow, landCol)) continue;
      const enemySquare = squareIndex(enemyRow, enemyCol);
      const landSquare = squareIndex(landRow, landCol);
      const occupant = board[enemySquare];
      if (
        occupant !== 0 &&
        Math.sign(occupant) === -side &&
        !capturedSet.has(enemySquare) &&
        board[landSquare] === 0
      ) {
        hops.push({ to: landSquare, captured: enemySquare });
      }
    } else {
      let r = row + dr;
      let c = col + dc;
      while (isOnBoard(r, c) && board[squareIndex(r, c)] === 0) {
        r += dr;
        c += dc;
      }
      if (!isOnBoard(r, c)) continue;
      const blockerSquare = squareIndex(r, c);
      const occupant = board[blockerSquare];
      if (occupant !== 0 && Math.sign(occupant) === -side && !capturedSet.has(blockerSquare)) {
        let lr = r + dr;
        let lc = c + dc;
        while (isOnBoard(lr, lc) && board[squareIndex(lr, lc)] === 0) {
          hops.push({ to: squareIndex(lr, lc), captured: blockerSquare });
          lr += dr;
          lc += dc;
        }
      }
    }
  }
  return hops;
}

function buildMove(from: number, path: number[], captures: number[], piece: Cell): Move {
  const to = path[path.length - 1];
  const side = Math.sign(piece) as Side;
  const promotes = !isKing(piece) && rowOf(to) === farRow(side);
  return { from, to, path, captures, piece, promotes };
}

/** Every maximal capture sequence (a complete move) starting at `from`. */
export function captureSequencesFrom(board: BoardArray, from: number, side: Side): Move[] {
  const complete: Move[] = [];
  const piece = board[from] as Cell;
  const pieceIsKing = isKing(piece);

  function dfs(
    current: number,
    path: number[],
    captures: number[],
    capturedSet: ReadonlySet<number>,
    workingBoard: BoardArray,
  ): void {
    const hops = captureHops(workingBoard, current, side, pieceIsKing, capturedSet);
    if (hops.length === 0) {
      if (captures.length > 0) {
        complete.push(buildMove(from, path, captures, piece));
      }
      return;
    }
    for (const hop of hops) {
      const nextBoard = workingBoard.slice();
      nextBoard[current] = 0;
      nextBoard[hop.to] = piece;
      const nextCapturedSet = new Set(capturedSet);
      nextCapturedSet.add(hop.captured);
      dfs(hop.to, [...path, hop.to], [...captures, hop.captured], nextCapturedSet, nextBoard);
    }
  }

  dfs(from, [from], [], new Set(), board);
  return complete;
}

/** Simple (non-capturing) moves starting at `from`. */
export function simpleMovesFrom(board: BoardArray, from: number, side: Side): Move[] {
  const moves: Move[] = [];
  const piece = board[from] as Cell;
  const pieceIsKing = isKing(piece);
  const row = rowOf(from);
  const col = colOf(from);
  const dirs = pieceIsKing ? ALL_DIAGONALS : forwardDirs(side);

  for (const [dr, dc] of dirs) {
    if (!pieceIsKing) {
      const r = row + dr;
      const c = col + dc;
      if (isOnBoard(r, c) && board[squareIndex(r, c)] === 0) {
        moves.push(buildMove(from, [from, squareIndex(r, c)], [], piece));
      }
    } else {
      let r = row + dr;
      let c = col + dc;
      while (isOnBoard(r, c) && board[squareIndex(r, c)] === 0) {
        moves.push(buildMove(from, [from, squareIndex(r, c)], [], piece));
        r += dr;
        c += dc;
      }
    }
  }
  return moves;
}

function squaresOf(board: BoardArray, side: Side): number[] {
  const squares: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (Math.sign(board[i]) === side) squares.push(i);
  }
  return squares;
}

/**
 * All legal moves for `side`. Capture is compulsory: if any capture exists for any piece,
 * only capture sequences are legal. In strict mode, only the sequence(s) with the most
 * captures (across the whole side) are legal.
 */
export function generateLegalMoves(board: BoardArray, side: Side, strictMode: boolean): Move[] {
  const squares = squaresOf(board, side);
  const captures: Move[] = [];
  for (const square of squares) {
    captures.push(...captureSequencesFrom(board, square, side));
  }

  if (captures.length > 0) {
    if (!strictMode) return captures;
    const maxCaptures = Math.max(...captures.map((m) => m.captures.length));
    return captures.filter((m) => m.captures.length === maxCaptures);
  }

  const simples: Move[] = [];
  for (const square of squares) {
    simples.push(...simpleMovesFrom(board, square, side));
  }
  return simples;
}

export function applyMove(board: BoardArray, move: Move): BoardArray {
  const next = board.slice();
  next[move.from] = 0;
  for (const captured of move.captures) {
    next[captured] = 0;
  }
  const side = Math.sign(move.piece);
  next[move.to] = move.promotes ? ((side * 2) as Cell) : move.piece;
  return next;
}

export function moveNotation(move: Move): string {
  const separator = move.captures.length > 0 ? 'x' : '-';
  return move.path.map(squareName).join(separator);
}

/** Sorted notation list, handy for test assertions. */
export function sortedNotations(moves: Move[]): string[] {
  return moves.map(moveNotation).sort();
}
