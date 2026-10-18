import { colOf, isKing, rowOf } from './board';
import { applyMove, generateLegalMoves } from './moves';
import { BoardArray, LIGHT, Move, Side } from './types';

export type Difficulty = 'beginner' | 'novice' | 'very-good';

export interface AiOptions {
  difficulty: Difficulty;
  strictMode: boolean;
  /** Injectable for deterministic tests; defaults to Math.random. */
  rng?: () => number;
  /** Injectable clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
  /** Time budget in ms for the "very-good" level's iterative deepening. */
  timeBudgetMs?: number;
}

const MAN_VALUE = 100;
const KING_VALUE = 330;
const WIN_SCORE = 1_000_000;

function evaluate(board: BoardArray): number {
  let score = 0;
  for (let square = 0; square < board.length; square++) {
    const cell = board[square];
    if (cell === 0) continue;
    const side = Math.sign(cell) as Side;
    const kinged = isKing(cell);
    const row = rowOf(square);
    const col = colOf(square);

    let value = kinged ? KING_VALUE : MAN_VALUE;
    if (!kinged) {
      const advancement = side === LIGHT ? row : 9 - row;
      value += advancement * 2;
    }
    const backRow = side === LIGHT ? 0 : 9;
    if (row === backRow) value += 5;
    const centreDistance = Math.abs(col - 4.5) + Math.abs(row - 4.5);
    value += Math.max(0, 6 - centreDistance);

    score += side * value;
  }
  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const score = (m: Move) => m.captures.length * 1000 + (m.promotes ? 500 : 0);
    return score(b) - score(a);
  });
}

/**
 * Negamax with alpha-beta pruning. Quiescence: once depth reaches 0, keep searching
 * while the side to move is in a forced-capture position, so the search never stops
 * mid-exchange.
 */
function negamax(
  board: BoardArray,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  strictMode: boolean,
): number {
  const moves = generateLegalMoves(board, side, strictMode);
  if (moves.length === 0) {
    return -WIN_SCORE;
  }

  const inForcedCapture = moves[0].captures.length > 0;
  if (depth <= 0 && !inForcedCapture) {
    return side * evaluate(board);
  }

  let best = -Infinity;
  for (const move of orderMoves(moves)) {
    const nextBoard = applyMove(board, move);
    const value = -negamax(nextBoard, (-side) as Side, depth - 1, -beta, -alpha, strictMode);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchRoot(
  board: BoardArray,
  side: Side,
  depth: number,
  strictMode: boolean,
  moves: Move[],
): { move: Move; score: number }[] {
  const results: { move: Move; score: number }[] = [];
  for (const move of orderMoves(moves)) {
    const nextBoard = applyMove(board, move);
    const score = -negamax(nextBoard, (-side) as Side, depth - 1, -Infinity, Infinity, strictMode);
    results.push({ move, score });
  }
  return results;
}

function pickWithNoise(
  results: { move: Move; score: number }[],
  noise: number,
  rng: () => number,
): Move {
  let best = results[0];
  let bestNoisy = best.score + (rng() * 2 - 1) * noise;
  for (let i = 1; i < results.length; i++) {
    const noisy = results[i].score + (rng() * 2 - 1) * noise;
    if (noisy > bestNoisy) {
      best = results[i];
      bestNoisy = noisy;
    }
  }
  return best.move;
}

/** Picks a move for `side` to play. Returns null when there is no legal move. */
export function chooseMove(board: BoardArray, side: Side, options: AiOptions): Move | null {
  const moves = generateLegalMoves(board, side, options.strictMode);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;

  switch (options.difficulty) {
    case 'beginner': {
      if (rng() < 0.35) {
        return moves[Math.floor(rng() * moves.length)];
      }
      const results = searchRoot(board, side, 1, options.strictMode, moves);
      return pickWithNoise(results, 160, rng);
    }
    case 'novice': {
      const results = searchRoot(board, side, 3, options.strictMode, moves);
      return pickWithNoise(results, 40, rng);
    }
    case 'very-good': {
      const budget = options.timeBudgetMs ?? 300;
      const deadline = now() + budget;
      let best = moves[0];
      let depth = 1;
      while (now() < deadline && depth <= 12) {
        const results = searchRoot(board, side, depth, options.strictMode, moves);
        results.sort((a, b) => b.score - a.score);
        best = results[0].move;
        if (Math.abs(results[0].score) >= WIN_SCORE - 100) break;
        depth++;
      }
      return best;
    }
  }
}

export { evaluate };
