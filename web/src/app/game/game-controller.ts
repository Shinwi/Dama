import { Difficulty } from '../../engine/ai';
import {
  advanceState,
  createInitialState,
  legalMoves as engineLegalMoves,
  outcome as engineOutcome,
  passTurn,
  pieceCounts as enginePieceCounts,
  takeForfeit,
} from '../../engine/game';
import { GameState, LIGHT, Move, Outcome, Side } from '../../engine/types';
import { RoomAction } from '../../protocol/online';

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

/**
 * One turn as the move list shows it: who played, the piece they took by nfikh first (if
 * any), and their move, or null if they ran out of time and the turn was skipped.
 */
export interface Ply {
  side: Side;
  nfikh: number | null;
  move: Move | null;
}

/** The move timer choices on the home screen, in seconds; 0 is no timer. */
export const MOVE_TIMES = [0, 30, 45, 60] as const;

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
  /**
   * The move timer, in seconds (0: none). Online, the room's creator sets it for both
   * players and the server keeps the time; offline, the browser does.
   */
  moveTime: number;
}

interface Snapshot {
  state: GameState;
  lastMove: Move | null;
  lastNfikh: Nfikh | null;
  lastTimeout: Side | null;
  plyCount: number;
  turnNfikh: number | null;
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
    boardTheme: 'green',
    moveTime: 30,
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

  /** The side whose turn was just skipped because its time ran out, until the next move. */
  lastTimeout: Side | null = null;

  /** Why the last 'illegal' tap was refused, and where it was. */
  rejection: { square: number; reason: RejectReason } | null = null;

  /** Every turn played so far, for the move list. */
  plies: Ply[] = [];
  /** The piece taken by nfikh on the turn being played, until its move completes it. */
  private turnNfikh: number | null = null;

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
    this.pushHistory();
    this.lastNfikh = { square, by: this.state.toMove };
    this.turnNfikh = square;
    this.state = takeForfeit(this.state, square);
    this.resetSelection();
  }

  /**
   * The side to move ran out of time: its turn is skipped (see the engine's passTurn). A
   * capture being tapped out is dropped. Ignored once the game is over.
   */
  passTurn(): void {
    if (this.outcome.kind !== 'ongoing') return;
    this.pushHistory();
    const side = this.state.toMove;
    this.plies = [...this.plies, { side, nfikh: this.turnNfikh, move: null }];
    this.turnNfikh = null;
    if (this.lastNfikh && this.lastNfikh.by !== side) this.lastNfikh = null;
    this.lastTimeout = side;
    this.state = passTurn(this.state);
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
    this.lastTimeout = previous.lastTimeout;
    this.plies = this.plies.slice(0, previous.plyCount);
    this.turnNfikh = previous.turnNfikh;
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
  loadPosition(state: GameState, plies: Ply[] = []): void {
    this.state = state;
    this.lastMove = null;
    this.lastNfikh = null;
    this.lastTimeout = null;
    this.plies = plies;
    this.turnNfikh = null;
    this.history = [];
    this.resetSelection();
  }

  /**
   * Like loadPosition, from the server's list of the game's actions, which also gives the
   * move list. `state` is the server's position: it's the one used, should replaying the
   * actions here ever come out different.
   */
  loadHistory(actions: RoomAction[], state: GameState): void {
    const replay = new GameController({ ...this.settings, strictMode: state.strictMode });
    for (const action of actions) {
      if (action.kind === 'nfikh') replay.takeForfeit(action.square);
      else if (action.kind === 'timeout') replay.passTurn();
      else {
        const move = replay.legalMoves.find((m) => m.path.length === action.path.length && m.path.every((sq, i) => sq === action.path[i]));
        if (!move) return this.loadPosition(state); // can't follow it: just the position, no list
        replay.commitMove(move);
      }
    }
    this.loadPosition(state, replay.plies);
    // The latest move stays highlighted, as it would have been had it been played here.
    this.lastMove = replay.lastMove;
    this.lastTimeout = replay.lastTimeout;
  }

  newGame(partial?: Partial<Settings>): void {
    this.settings = { ...this.settings, ...partial };
    this.state = createInitialState(this.settings.strictMode);
    this.lastMove = null;
    this.lastNfikh = null;
    this.lastTimeout = null;
    this.plies = [];
    this.turnNfikh = null;
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
    this.pushHistory();
    // A piece taken by nfikh stays news through the taker's own move, until the other side moves.
    if (this.lastNfikh && this.lastNfikh.by !== this.state.toMove) this.lastNfikh = null;
    this.lastTimeout = null;
    this.plies = [...this.plies, { side: this.state.toMove, nfikh: this.turnNfikh, move }];
    this.turnNfikh = null;
    this.state = advanceState(this.state, move);
    this.lastMove = move;
    this.resetSelection();
  }

  private pushHistory(): void {
    this.history.push({
      state: this.state,
      lastMove: this.lastMove,
      lastNfikh: this.lastNfikh,
      lastTimeout: this.lastTimeout,
      plyCount: this.plies.length,
      turnNfikh: this.turnNfikh,
    });
  }
}
