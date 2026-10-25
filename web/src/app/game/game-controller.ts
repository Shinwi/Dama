import { Difficulty } from '../../engine/ai';
import { advanceState, createInitialState, legalMoves as engineLegalMoves, outcome as engineOutcome, pieceCounts as enginePieceCounts, takeForfeit } from '../../engine/game';
import { GameState, LIGHT, Move, Outcome, Side } from '../../engine/types';

export type GameMode = 'computer' | 'pvp' | 'online';
export type BoardTheme = 'classic' | 'wood' | 'green';

/** How the board got to its latest position (see GameService.updateKind). */
export type UpdateKind = 'reset' | 'move' | 'nfikh';

/**
 * What a tap did: nothing to complete yet ('none': picked a piece up, put it down, or chose
 * the way), completed a move, took a piece by nfikh, or was refused ('illegal', see
 * GameController.rejection for why).
 */
export type TapResult = 'none' | 'move' | 'nfikh' | 'illegal';

/**
 * Why a tap was refused. Says only what's on the board where the player tapped, never what
 * they could do instead (no hints: spotting captures is up to them).
 */
export type RejectReason =
  /** Nothing selected, and the square is empty. */
  | 'empty'
  /** The selected piece can't end its move there. */
  | 'unreachable'
  /** An opponent's piece that can't be taken (by nfikh). */
  | 'opponent'
  /** One of the player's own pieces, which has no move. */
  | 'stuck'
  /** Choosing between routes, and the square isn't on any of them. */
  | 'route';

/** A piece taken by nfikh: where it was, and which side took it. */
export interface Nfikh {
  square: number;
  by: Side;
}

export interface Settings {
  mode: GameMode;
  difficulty: Difficulty;
  /**
   * Side the human plays when mode === 'computer'. Unused in 'pvp'; in 'online' the server
   * says which side you play (GameService.playerSide), and this setting is left alone.
   */
  playerSide: Side;
  strictMode: boolean;
  soundOn: boolean;
  musicOn: boolean;
  boardTheme: BoardTheme;
}

interface Snapshot {
  state: GameState;
  lastMove: Move | null;
  lastNfikh: Nfikh | null;
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
}

export function defaultSettings(): Settings {
  return {
    mode: 'computer',
    difficulty: 'novice',
    playerSide: LIGHT,
    strictMode: false,
    soundOn: true,
    musicOn: false,
    boardTheme: 'classic',
  };
}

const EMPTY_SELECTION: SelectionInfo = {
  selected: null,
  path: [],
  candidateMoves: [],
  target: null,
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
  /**
   * The latest piece taken by nfikh, kept until the other side next moves, so the screen can
   * say what happened.
   */
  lastNfikh: Nfikh | null = null;

  /** Why the last 'illegal' tap was refused, and where it was. */
  rejection: { square: number; reason: RejectReason } | null = null;

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

  /** Undo is a vs-computer feature, and needs a move of the player's to take back. */
  canUndo(): boolean {
    return this.lastPlayerMoveIndex() >= 0;
  }

  resetSelection(): void {
    this.selection = EMPTY_SELECTION;
  }

  /**
   * Handles a tap on a board square, and says what it did.
   *
   * A move is two taps: the piece, then where it ends up, even for a multi-jump (the board
   * then animates it through every square on the way). Only when two capture routes end on
   * the same square does the player have to say which, by tapping where the routes split.
   *
   * Tapping one of the opponent's pieces that skipped a capture last move takes it (nfikh);
   * the player then makes their move as usual. Nothing points those pieces out: spotting the
   * missed capture is up to the player.
   */
  tapSquare(square: number): TapResult {
    this.rejection = null;
    if (this.outcome.kind !== 'ongoing') return 'none';

    if (this.state.forfeitable.includes(square)) {
      this.takeForfeit(square);
      return 'nfikh';
    }

    if (this.selection.selected === null) {
      return this.trySelect(square) ? 'none' : this.reject(square, this.reasonAt(square, 'empty'));
    }

    const { selected, path, candidateMoves, target } = this.selection;

    if (target === null) {
      const ending = candidateMoves.filter((m) => m.to === square);
      if (ending.length === 1) {
        this.commitMove(ending[0]);
        return 'move';
      }
      if (ending.length > 1) {
        this.chooseRoute(path, ending, square);
        return 'none';
      }
      if (square === selected) {
        this.resetSelection();
        return 'none';
      }
      // Another of the player's pieces: pick that one up instead. Anything else is refused,
      // and the selected piece stays selected, ready for the right square.
      return this.trySelect(square) ? 'none' : this.reject(square, this.reasonAt(square, 'unreachable'));
    }

    // A king's route can pass through its destination and come back to it later; the route
    // that stops there the first time is played by tapping the destination again.
    const stopsHere = candidateMoves.find((m) => m.path.length === path.length);
    if (square === target && stopsHere) {
      this.commitMove(stopsHere);
      return 'move';
    }
    const routes = candidateMoves.filter((m) => m.path[path.length] === square);
    if (routes.length === 1) {
      this.commitMove(routes[0]);
      return 'move';
    }
    if (routes.length > 1) {
      this.chooseRoute([...path, square], routes, target);
      return 'none';
    }
    if (square === selected) {
      // Changed their mind: put the piece back down. (A route can also pass back through the
      // starting square, so that's checked first.)
      this.resetSelection();
      return 'none';
    }
    return this.reject(square, 'route');
  }

  private reject(square: number, reason: RejectReason): 'illegal' {
    this.rejection = { square, reason };
    return 'illegal';
  }

  /** Why a tap on `square` that selects nothing is refused; `ifEmpty` for an empty square. */
  private reasonAt(square: number, ifEmpty: 'empty' | 'unreachable'): RejectReason {
    const owner = Math.sign(this.state.board[square]);
    if (owner === 0) return ifEmpty;
    return owner === this.state.toMove ? 'stuck' : 'opponent';
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

  /** Takes an opponent's piece that skipped a capture (nfikh). Ignored if it isn't one. */
  takeForfeit(square: number): void {
    if (!this.state.forfeitable.includes(square)) return;
    this.history.push({ state: this.state, lastMove: this.lastMove, lastNfikh: this.lastNfikh });
    this.lastNfikh = { square, by: this.state.toMove };
    this.state = takeForfeit(this.state, square);
    this.resetSelection();
  }

  /**
   * Takes back the player's last move, along with the computer's reply to it if one has been
   * played, so it's the player's turn again. Never undoes a computer move that came before
   * it, such as the computer's opening when the player is Dark. Vs computer only.
   */
  undo(): void {
    const index = this.lastPlayerMoveIndex();
    if (index < 0) return;
    const previous = this.history[index];
    this.history = this.history.slice(0, index);
    this.state = previous.state;
    this.lastMove = previous.lastMove;
    this.lastNfikh = previous.lastNfikh;
    this.resetSelection();
  }

  /** History index of the position just before the player's latest move, or -1 if none. */
  private lastPlayerMoveIndex(): number {
    if (this.settings.mode !== 'computer') return -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].state.toMove === this.settings.playerSide) return i;
    }
    return -1;
  }

  /**
   * Jumps straight to a position that came from elsewhere (the online server, when this
   * copy has fallen out of step with it). No history: there's nothing to undo online.
   */
  loadPosition(state: GameState): void {
    this.state = state;
    this.lastMove = null;
    this.lastNfikh = null;
    this.history = [];
    this.resetSelection();
  }

  newGame(partial?: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    this.state = createInitialState(this.settings.strictMode);
    this.lastMove = null;
    this.lastNfikh = null;
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

  /** Picks up the player's piece on `square`, if it has a move. Leaves the selection alone if not. */
  private trySelect(square: number): boolean {
    const ownPiece = Math.sign(this.state.board[square]) === this.state.toMove;
    const candidateMoves = ownPiece ? this.legalMoves.filter((m) => m.from === square) : [];
    if (candidateMoves.length === 0) return false;
    this.selection = { ...EMPTY_SELECTION, selected: square, path: [square], candidateMoves };
    return true;
  }

  private commitMove(move: Move): void {
    this.history.push({ state: this.state, lastMove: this.lastMove, lastNfikh: this.lastNfikh });
    // A piece taken by nfikh stays news through the taker's own move, until the other side moves.
    if (this.lastNfikh && this.lastNfikh.by !== this.state.toMove) this.lastNfikh = null;
    this.state = advanceState(this.state, move);
    this.lastMove = move;
    this.resetSelection();
  }
}
