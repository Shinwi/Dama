import { colOf, isKing, rowOf } from './board';
import { applyMove, forfeitableAfter, generateLegalMoves, removePiece } from './moves';
import { BoardArray, LIGHT, Move, Side, Turn } from './types';

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
 * Lets a timed search give up part-way: it checks the clock every so many positions and,
 * once past the deadline, sets `timedOut` and unwinds. A search that timed out has no
 * usable result.
 */
interface SearchClock {
  deadline: number;
  now: () => number;
  nodes: number;
  timedOut: boolean;
}

/** Positions searched between clock checks: often enough to stop promptly, cheap enough. */
const CLOCK_CHECK_INTERVAL = 256;

function outOfTime(clock: SearchClock | undefined): boolean {
  if (!clock) return false;
  const checkNow = ++clock.nodes % CLOCK_CHECK_INTERVAL === 0;
  if (!clock.timedOut && checkNow && clock.now() >= clock.deadline) clock.timedOut = true;
  return clock.timedOut;
}

/**
 * Negamax with alpha-beta pruning, over turns: the side to move may first take a piece by
 * nfikh (from `forfeitable`, which keeps it the same side's turn) and then plays a move.
 * Quiescence: once depth reaches 0, the side to move can stand pat on the static evaluation
 * or keep going with captures (and nfikh), so the search never stops mid-exchange.
 */
function negamax(
  board: BoardArray,
  side: Side,
  forfeitable: number[],
  depth: number,
  alpha: number,
  beta: number,
  strictMode: boolean,
  clock?: SearchClock,
): number {
  if (outOfTime(clock)) return 0;
  const moves = generateLegalMoves(board, side, strictMode);
  if (moves.length === 0 && forfeitable.length === 0) {
    return -WIN_SCORE;
  }

  const quiescent = depth <= 0;
  let best = -Infinity;
  if (quiescent) {
    best = side * evaluate(board);
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  }

  for (const square of forfeitable) {
    // Nfikh doesn't pass the turn: same side, same depth, no negation.
    const value = negamax(removePiece(board, square), side, [], depth, alpha, beta, strictMode, clock);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) return best;
  }

  for (const move of orderMoves(moves)) {
    if (quiescent && move.captures.length === 0) continue;
    const nextBoard = applyMove(board, move);
    const value = -negamax(
      nextBoard,
      (-side) as Side,
      forfeitableAfter(board, move),
      depth - 1,
      -beta,
      -alpha,
      strictMode,
      clock,
    );
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Every turn `side` can play: each move, with no nfikh and after each possible nfikh. */
function legalTurns(board: BoardArray, side: Side, forfeitable: number[], strictMode: boolean): Turn[] {
  const turns: Turn[] = generateLegalMoves(board, side, strictMode).map((move) => ({ nfikh: null, move }));
  for (const square of forfeitable) {
    for (const move of generateLegalMoves(removePiece(board, square), side, strictMode)) {
      turns.push({ nfikh: square, move });
    }
  }
  return turns;
}

function orderTurns(turns: Turn[]): Turn[] {
  const score = (t: Turn) => (t.nfikh !== null ? 2000 : 0) + t.move.captures.length * 1000 + (t.move.promotes ? 500 : 0);
  return [...turns].sort((a, b) => score(b) - score(a));
}

function searchRoot(
  board: BoardArray,
  side: Side,
  depth: number,
  strictMode: boolean,
  turns: Turn[],
  clock?: SearchClock,
): { turn: Turn; score: number }[] {
  const results: { turn: Turn; score: number }[] = [];
  for (const turn of orderTurns(turns)) {
    const before = turn.nfikh === null ? board : removePiece(board, turn.nfikh);
    const nextBoard = applyMove(before, turn.move);
    const score = -negamax(
      nextBoard,
      (-side) as Side,
      forfeitableAfter(before, turn.move),
      depth - 1,
      -Infinity,
      Infinity,
      strictMode,
      clock,
    );
    if (clock?.timedOut) break;
    results.push({ turn, score });
  }
  return results;
}

function pickWithNoise(
  results: { turn: Turn; score: number }[],
  noise: number,
  rng: () => number,
): Turn {
  let best = results[0];
  let bestNoisy = best.score + (rng() * 2 - 1) * noise;
  for (let i = 1; i < results.length; i++) {
    const noisy = results[i].score + (rng() * 2 - 1) * noise;
    if (noisy > bestNoisy) {
      best = results[i];
      bestNoisy = noisy;
    }
  }
  return best.turn;
}

/**
 * Picks a turn for `side` to play: whether to take one of `forfeitable` by nfikh first, and
 * the move. Returns null when there is no legal move.
 */
export function chooseTurn(
  board: BoardArray,
  side: Side,
  forfeitable: number[],
  options: AiOptions,
): Turn | null {
  const turns = legalTurns(board, side, forfeitable, options.strictMode);
  if (turns.length === 0) return null;
  if (turns.length === 1) return turns[0];

  const rng = options.rng ?? Math.random;
  const now = options.now ?? Date.now;

  switch (options.difficulty) {
    case 'beginner': {
      if (rng() < 0.35) {
        return turns[Math.floor(rng() * turns.length)];
      }
      const results = searchRoot(board, side, 1, options.strictMode, turns);
      return pickWithNoise(results, 160, rng);
    }
    case 'novice': {
      const results = searchRoot(board, side, 3, options.strictMode, turns);
      return pickWithNoise(results, 40, rng);
    }
    case 'very-good': {
      // Iterative deepening within the time budget. The clock is checked inside the search,
      // not just between depths, so a deep search that runs out of time is abandoned (and
      // the previous depth's answer kept) instead of overrunning the budget many times over.
      const budget = options.timeBudgetMs ?? 300;
      const clock: SearchClock = { deadline: now() + budget, now, nodes: 0, timedOut: false };
      let best = turns[0];
      for (let depth = 1; depth <= 12; depth++) {
        // Depth 1 always runs to completion, so there's always a searched move to play.
        const timed = depth > 1 ? clock : undefined;
        const results = searchRoot(board, side, depth, options.strictMode, turns, timed);
        if (clock.timedOut) break;
        results.sort((a, b) => b.score - a.score);
        best = results[0].turn;
        if (Math.abs(results[0].score) >= WIN_SCORE - 100 || now() >= clock.deadline) break;
      }
      return best;
    }
  }
}

/** Picks a move for `side` when there's nothing to take by nfikh. Null when there is no legal move. */
export function chooseMove(board: BoardArray, side: Side, options: AiOptions): Move | null {
  return chooseTurn(board, side, [], options)?.move ?? null;
}

export { evaluate };
