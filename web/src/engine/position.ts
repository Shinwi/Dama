import {
  BOARD_SIZE,
  colOf,
  createEmptyBoard,
  isKing,
  isPlayableSquare,
  parseSquare,
  rowOf,
  squareName,
} from './board';
import { farRow } from './moves';
import { BoardArray, Cell, DARK, GameState, LIGHT, Side } from './types';

/**
 * Position codes: a compact, URL-safe text form of a board + side to move, for setting up
 * test scenarios (dev-only `?position=` deep links and the setup editor).
 *
 *   L:b4,c3,Ke5;D:f6,g7,Kh8;t:L;q:0
 *
 * `L:`/`D:` list Light/Dark pieces (`K` prefix = king), `t:` is the side to move (default
 * `L`), `q:` the quiet-move counter (default 0). Strict mode is deliberately not part of the
 * code — it comes from the normal setting, so one position can be tested both ways.
 */

export const MAX_PIECES_PER_SIDE = 20;

export type PositionState = Pick<GameState, 'board' | 'toMove' | 'quietMoves'>;

export type DecodeResult = { ok: true; state: GameState } | { ok: false; errors: string[] };

const SQUARE_PATTERN = /^[a-j](10|[1-9])$/;

/**
 * A man can't stand unpromoted on its own far row (promotion happens on landing there), so a
 * man placed there is turned into a king. Anything else is returned unchanged.
 */
export function normalizeCell(square: number, cell: Cell): Cell {
  if (cell === 0 || isKing(cell)) return cell;
  const side = Math.sign(cell) as Side;
  return rowOf(square) === farRow(side) ? ((side * 2) as Cell) : cell;
}

/** Canonical code: pieces in square order, `t:` always present, `q:` only when non-zero. */
export function encodePosition(state: PositionState): string {
  const light: string[] = [];
  const dark: string[] = [];
  state.board.forEach((cell, square) => {
    if (cell === 0) return;
    const name = (isKing(cell) ? 'K' : '') + squareName(square);
    (cell > 0 ? light : dark).push(name);
  });
  const parts = [
    `L:${light.join(',')}`,
    `D:${dark.join(',')}`,
    `t:${state.toMove === LIGHT ? 'L' : 'D'}`,
  ];
  if (state.quietMoves !== 0) parts.push(`q:${state.quietMoves}`);
  return parts.join(';');
}

/** Problems that make a position unplayable, as readable messages. Empty = valid. */
export function validatePosition(state: PositionState): string[] {
  const errors: string[] = [];
  let light = 0;
  let dark = 0;
  state.board.forEach((cell, square) => {
    if (cell === 0) return;
    const name = squareName(square);
    if (!isPlayableSquare(rowOf(square), colOf(square))) {
      errors.push(`${name} is not a playable square`);
    }
    if (normalizeCell(square, cell as Cell) !== cell) {
      errors.push(`${name}: a man can't stand on its own promotion row`);
    }
    if (cell > 0) light++;
    else dark++;
  });
  if (light > MAX_PIECES_PER_SIDE)
    errors.push(`Light has ${light} pieces (max ${MAX_PIECES_PER_SIDE})`);
  if (dark > MAX_PIECES_PER_SIDE)
    errors.push(`Dark has ${dark} pieces (max ${MAX_PIECES_PER_SIDE})`);
  if (!Number.isInteger(state.quietMoves) || state.quietMoves < 0) {
    errors.push(`Quiet-move count must be a whole number ≥ 0`);
  }
  return errors;
}

/**
 * Parses a position code. Tolerates whitespace and any letter case. Collects every problem
 * (syntax and validation) rather than stopping at the first. A position where the side to
 * move has no legal moves is valid — it just starts as a finished game.
 */
export function decodePosition(code: string, strictMode = false): DecodeResult {
  const errors: string[] = [];
  const board: BoardArray = createEmptyBoard();
  const placed = new Set<number>();
  const seenKeys = new Set<string>();
  let toMove: Side = LIGHT;
  let quietMoves = 0;

  const sections = code
    .replace(/\s+/g, '')
    .split(';')
    .filter((s) => s !== '');
  for (const section of sections) {
    const colon = section.indexOf(':');
    if (colon < 0) {
      errors.push(`"${section}" is missing a ':'`);
      continue;
    }
    const key = section.slice(0, colon).toUpperCase();
    const value = section.slice(colon + 1);
    if (seenKeys.has(key)) {
      errors.push(`"${key}:" appears more than once`);
      continue;
    }
    seenKeys.add(key);

    switch (key) {
      case 'L':
      case 'D':
        parsePieces(value, key === 'L' ? LIGHT : DARK, board, placed, errors);
        break;
      case 'T': {
        const side = value.toUpperCase();
        if (side === 'L') toMove = LIGHT;
        else if (side === 'D') toMove = DARK;
        else errors.push(`"t:${value}" must be L or D`);
        break;
      }
      case 'Q':
        if (/^\d+$/.test(value)) quietMoves = Number.parseInt(value, 10);
        else errors.push(`"q:${value}" must be a whole number ≥ 0`);
        break;
      default:
        errors.push(`Unknown section "${key}:"`);
    }
  }

  errors.push(...validatePosition({ board, toMove, quietMoves }));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state: { board, toMove, strictMode, quietMoves } };
}

function parsePieces(
  value: string,
  side: Side,
  board: BoardArray,
  placed: Set<number>,
  errors: string[],
): void {
  for (const raw of value.split(',')) {
    if (raw === '') continue;
    const king = raw[0] === 'K' || raw[0] === 'k';
    const name = (king ? raw.slice(1) : raw).toLowerCase();
    if (!SQUARE_PATTERN.test(name)) {
      errors.push(`"${raw}" is not a square (a1–j${BOARD_SIZE})`);
      continue;
    }
    const square = parseSquare(name);
    if (placed.has(square)) {
      errors.push(`${name} is listed more than once`);
      continue;
    }
    placed.add(square);
    board[square] = normalizeCell(square, (side * (king ? 2 : 1)) as Cell);
  }
}
