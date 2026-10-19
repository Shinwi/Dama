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

  /** Handles a tap on a board square. Returns true if it completed a full move. */
  tapSquare(square: number): boolean {
    if (this.outcome.kind !== 'ongoing') return false;

    if (this.selection.selected === null) {
      this.trySelect(square);
      return false;
    }

    if (square === this.selection.selected && this.selection.path.length === 1) {
      this.resetSelection();
      return false;
    }

    const finishers = this.selection.candidateMoves.filter((m) => m.to === square);
    if (finishers.length === 1) {
      this.commitMove(finishers[0]);
      return true;
    }

    const nextStepIndex = this.selection.path.length;
    const advancing = this.selection.candidateMoves.filter((m) => m.path[nextStepIndex] === square);
    if (advancing.length > 0) {
      const path = [...this.selection.path, square];
      if (advancing.length === 1 && advancing[0].path.length === path.length) {
        this.commitMove(advancing[0]);
        return true;
      }
      this.selection = { ...this.selection, path, candidateMoves: advancing };
      return false;
    }

    if (this.selection.path.length === 1) {
      this.trySelect(square);
    }
    return false;
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

  /**
   * Starts play from an arbitrary position (a test scenario). Clears the history, so undo
   * rewinds to this position at most. Strict mode comes from settings, not the position.
   */
  loadPosition(state: GameState): void {
    this.state = { ...state, board: new Int8Array(state.board), strictMode: this.settings.strictMode };
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
    this.selection = { selected: square, path: [square], candidateMoves, compulsorySquares: compulsory };
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
