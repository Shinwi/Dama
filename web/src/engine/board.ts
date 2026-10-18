import { BoardArray, LIGHT } from './types';

export const BOARD_SIZE = 10;
const FILES = 'abcdefghij';

export function squareIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

export function rowOf(square: number): number {
  return Math.floor(square / BOARD_SIZE);
}

export function colOf(square: number): number {
  return square % BOARD_SIZE;
}

export function isOnBoard(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Only the dark/playable squares are used, per the (row + col) even rule in this coordinate system. */
export function isPlayableSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 0;
}

export function squareName(square: number): string {
  const row = rowOf(square);
  const col = colOf(square);
  return `${FILES[col]}${row + 1}`;
}

export function parseSquare(name: string): number {
  const file = name[0]?.toLowerCase();
  const col = FILES.indexOf(file);
  const row = Number.parseInt(name.slice(1), 10) - 1;
  if (col < 0 || Number.isNaN(row) || !isOnBoard(row, col)) {
    throw new Error(`Invalid square name: ${name}`);
  }
  return squareIndex(row, col);
}

export function isKing(cell: number): boolean {
  return Math.abs(cell) === 2;
}

export function sideOf(cell: number): number {
  return Math.sign(cell);
}

export function createEmptyBoard(): BoardArray {
  return new Int8Array(100);
}

export function createInitialBoard(): BoardArray {
  const board = createEmptyBoard();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isPlayableSquare(row, col)) continue;
      if (row <= 3) {
        board[squareIndex(row, col)] = LIGHT;
      } else if (row >= 6) {
        board[squareIndex(row, col)] = -LIGHT;
      }
    }
  }
  return board;
}

/** Mirrors the board left-right (flips files). Useful to rule out direction-array bugs in tests. */
export function mirrorBoard(board: BoardArray): BoardArray {
  const mirrored = createEmptyBoard();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      mirrored[squareIndex(row, BOARD_SIZE - 1 - col)] = board[squareIndex(row, col)];
    }
  }
  return mirrored;
}

/** Builds a board from square names, for tests and fixtures. */
export function boardFrom(pieces: {
  light?: string[];
  dark?: string[];
  lightKings?: string[];
  darkKings?: string[];
}): BoardArray {
  const board = createEmptyBoard();
  for (const name of pieces.light ?? []) board[parseSquare(name)] = 1;
  for (const name of pieces.dark ?? []) board[parseSquare(name)] = -1;
  for (const name of pieces.lightKings ?? []) board[parseSquare(name)] = 2;
  for (const name of pieces.darkKings ?? []) board[parseSquare(name)] = -2;
  return board;
}
