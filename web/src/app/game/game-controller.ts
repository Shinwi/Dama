import { Difficulty } from '../../engine/ai';
import { advanceState, createInitialState, legalMoves as engineLegalMoves, outcome as engineOutcome, pieceCounts as enginePieceCounts } from '../../engine/game';
import { GameState, LIGHT, Move, Outcome, Side } from '../../engine/types';

export type GameMode = 'computer' | 'pvp';

export interface Settings {
  mode: GameMode;
  difficulty: Difficulty;
  /** Side the human plays when mode === 'computer'. In 'pvp' this is unused. */
  playerSide: Side;
  strictMode: boolean;
  soundOn: boolean;
  musicOn: boolean;
}

interface Snapshot {
  state: GameState;
  lastMove: Move | null;
}

export interface SelectionInfo {
  selected: number | null;
  /** Squares visited so far, including the selected square, once a piece is picked. */
  path: number[];
  /** Full legal moves still consistent with `path`. */
  candidateMoves: Move[];
  /**
   * Set when the tapped destination can be reached by more than one capture route: the
   * player then picks the route by tapping where the routes split. Null otherwise.
   */
  target: number | null;
  /** Squares with a piece that must move this turn, because capture is compulsory. */
  compulsorySquares: number[];
}

export function defaultSettings(): Settings {
  return {
    mode: 'computer',
    difficulty: 'novice',
    playerSide: LIGHT,
    strictMode: false,
    soundOn: true,
    musicOn: false,
  };
}

const EMPTY_SELECTION: SelectionInfo = {
  selected: null,
  path: [],
  candidateMoves: [],
  target: null,
  compulsorySquares: [],
};

/**
 * Framework-free game flow: owns the engine state, the tap-to-move selection, undo history
 * and settings. Angular components never touch this directly — GameService wraps it with
 * signals. Keeping it plain makes it trivial to unit test without Angular's test bed.
 */
export class GameController {
  settings: Settings;
  state: GameState;
  lastMove: Move | null = null;

  private history: Snapshot[] = [];
  private selection: SelectionInfo = EMPTY_SELECTION;

  constructor(settings: Settings) {
    this.settings = settings;
    this.state = createInitialState(settings.strictMode);
    this.resetSelection();
  }

  get legalMoves(): Move[] {
    return engineLegalMoves(this.state);
  }

  get outcome(): Outcome {
    return engineOutcome(this.state);
  }

  get pieceCounts(): { light: number; dark: number } {
    return enginePieceCounts(this.state);
  }

  get selectionInfo(): SelectionInfo {
    return this.selection;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  resetSelection(): void {
    const moves = this.outcome.kind === 'ongoing' ? this.legalMoves : [];
    this.selection = { ...EMPTY_SELECTION, compulsorySquares: compulsorySquaresFor(moves) };
  }

  /**
   * Handles a tap on a board square. Returns true if it completed a full move.
   *
   * A move is two taps: the piece, then where it ends up, even for a multi-jump (the board
   * then animates it through every square on the way). Only when two capture routes end on
   * the same square does the player have to say which, by tapping where the routes split.
   */
  tapSquare(square: number): boolean {
    if (this.outcome.kind !== 'ongoing') return false;

    if (this.selection.selected === null) {
      this.trySelect(square);
      return false;
    }

    const { selected, path, candidateMoves, target } = this.selection;

    if (target === null) {
      const ending = candidateMoves.filter((m) => m.to === square);
      if (ending.length === 1) {
        this.commitMove(ending[0]);
        return true;
      }
      if (ending.length > 1) {
        this.chooseRoute(path, ending, square);
        return false;
      }
      if (square === selected) {
        this.resetSelection();
      } else {
        this.trySelect(square);
      }
      return false;
    }

    // A king's route can pass through its destination and come back to it later; the route
    // that stops there the first time is played by tapping the destination again.
    const stopsHere = candidateMoves.find((m) => m.path.length === path.length);
    if (square === target && stopsHere) {
      this.commitMove(stopsHere);
      return true;
    }
    const routes = candidateMoves.filter((m) => m.path[path.length] === square);
    if (routes.length === 1) {
      this.commitMove(routes[0]);
      return true;
    }
    if (routes.length > 1) {
      this.chooseRoute([...path, square], routes, target);
    } else if (square === selected) {
      // Changed their mind: put the piece back down. (A route can also pass back through the
      // starting square, so that's checked first.)
      this.resetSelection();
    }
    return false;
  }

  /** Narrows to `routes` and follows them as far as they agree, up to where they split. */
  private chooseRoute(path: number[], routes: Move[], target: number): void {
    const shared = [...path];
    const shortest = Math.min(...routes.map((m) => m.path.length));
    while (shared.length < shortest && routes.every((m) => m.path[shared.length] === routes[0].path[shared.length])) {
      shared.push(routes[0].path[shared.length]);
    }
    this.selection = { ...this.selection, path: shared, candidateMoves: routes, target };
  }

  /** Applies a move chosen by the AI (or anything outside tap-to-move). */
  applyExternalMove(move: Move): void {
    this.commitMove(move);
  }

  /** Vs computer: undoes the player's move and the computer's reply together. 1v1: one move. */
  undo(): void {
    const steps = this.settings.mode === 'computer' ? 2 : 1;
    for (let i = 0; i < steps && this.history.length > 0; i++) {
      const previous = this.history.pop()!;
      this.state = previous.state;
      this.lastMove = previous.lastMove;
    }
    this.resetSelection();
  }

  newGame(partial?: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    this.state = createInitialState(this.settings.strictMode);
    this.lastMove = null;
    this.history = [];
    this.resetSelection();
  }

  updateSettings(partial: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    if (partial.strictMode !== undefined) {
      this.state = { ...this.state, strictMode: partial.strictMode };
      this.resetSelection();
    }
  }

  private trySelect(square: number): void {
    const moves = this.legalMoves;
    const compulsory = compulsorySquaresFor(moves);
    const ownPiece = Math.sign(this.state.board[square]) === this.state.toMove;
    const blockedByCompulsory = compulsory.length > 0 && !compulsory.includes(square);
    const candidateMoves = ownPiece && !blockedByCompulsory ? moves.filter((m) => m.from === square) : [];

    if (candidateMoves.length === 0) {
      this.selection = { ...EMPTY_SELECTION, compulsorySquares: compulsory };
      return;
    }
    this.selection = { ...EMPTY_SELECTION, selected: square, path: [square], candidateMoves, compulsorySquares: compulsory };
  }

  private commitMove(move: Move): void {
    this.history.push({ state: this.state, lastMove: this.lastMove });
    this.state = advanceState(this.state, move);
    this.lastMove = move;
    this.resetSelection();
  }
}

function compulsorySquaresFor(moves: Move[]): number[] {
  if (moves.length === 0 || moves[0].captures.length === 0) return [];
  return [...new Set(moves.map((m) => m.from))];
}
