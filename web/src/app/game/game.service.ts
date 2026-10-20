import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AiClient } from '../ai/ai-client';
import { AudioService } from '../audio/audio.service';
import { isKing, squareName } from '../../engine/board';
import { DARK, LIGHT, Move } from '../../engine/types';
import { defaultSettings, GameController, Settings } from './game-controller';

const STORAGE_KEY = 'dama.settings.v1';
/** Backstop in case the board never reports a move as settled: no animation is this long. */
const SETTLE_TIMEOUT_MS = 5000;

function loadSettings(): Settings {
  const fallback = defaultSettings();
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

function saveSettings(settings: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / quota exceeded — settings just won't persist this session.
  }
}

/**
 * Angular-facing wrapper around GameController: exposes its state as signals and
 * orchestrates the computer's turn (including the "computer opens as Light" case when the
 * human chooses to play Dark). `version` is bumped on every mutation so the computed()s
 * below re-read the (plain, non-reactive) controller.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly ai = new AiClient();
  private readonly audio = inject(AudioService);
  private readonly controller = new GameController(loadSettings());
  private readonly version = signal(0);

  private lastAnnouncedMove: Move | null = null;
  /** Whether the game was already over at the last update, so the result is announced once. */
  private wasOver = false;
  private updateKindValue: 'reset' | 'move' = 'reset';

  readonly thinking = signal(false);
  /** What just happened (a move, Undo, New game) in words, for screen readers to announce. */
  readonly announcement = signal('');
  /** A move is still playing out on the board: nobody can move until it has landed. */
  readonly moving = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped for every question put to the computer, and to abandon the one in flight. */
  private aiRequest = 0;

  readonly settings = computed(() => {
    this.version();
    return this.controller.settings;
  });
  readonly state = computed(() => {
    this.version();
    return this.controller.state;
  });
  readonly lastMove = computed(() => {
    this.version();
    return this.controller.lastMove;
  });
  /**
   * Tells Board whether the latest `state()` is reachable from the previous one by playing
   * `lastMove()` (so it can slide the piece hop by hop), or is an unrelated jump — new game
   * or undo — that should just snap to the new position with no animation.
   */
  readonly updateKind = computed(() => {
    this.version();
    return this.updateKindValue;
  });
  readonly selection = computed(() => {
    this.version();
    return this.controller.selectionInfo;
  });
  readonly outcome = computed(() => {
    this.version();
    return this.controller.outcome;
  });
  readonly pieceCounts = computed(() => {
    this.version();
    return this.controller.pieceCounts;
  });
  readonly canUndo = computed(() => {
    this.version();
    return this.controller.canUndo();
  });

  constructor() {
    this.audio.setSoundOn(this.controller.settings.soundOn);
    this.audio.setMusicOn(this.controller.settings.musicOn);

    effect(() => {
      const settings = this.settings();
      this.audio.setSoundOn(settings.soundOn);
      this.audio.setMusicOn(settings.musicOn);
    });

    effect(() => {
      const move = this.lastMove();
      const settings = this.settings();
      // Undo brings back an older `lastMove`, but nothing was just played: no sound for it.
      const justPlayed = this.updateKind() === 'move';
      if (move && move !== this.lastAnnouncedMove) {
        this.lastAnnouncedMove = move;
        if (justPlayed) {
          this.announceMove(move, settings);
          this.announcement.set(describeMove(move, settings));
        }
      }
    });

    effect(() => {
      const outcome = this.outcome();
      const settings = this.settings();
      // `outcome()` is a fresh object on every update, so compare what it says, not identity:
      // only the move that ends the game plays the jingle, not every tap or toggle after it.
      const justEnded = outcome.kind !== 'ongoing' && !this.wasOver;
      this.wasOver = outcome.kind !== 'ongoing';
      if (justEnded && outcome.kind === 'win') {
        const playerLost = settings.mode === 'computer' && outcome.winner !== settings.playerSide;
        if (playerLost) this.audio.loss();
        else this.audio.win();
      }
    });

    void this.maybeTriggerComputer();
  }

  tapSquare(square: number): void {
    if (this.thinking() || this.moving() || !this.isHumanTurn()) return;
    const completed = this.controller.tapSquare(square);
    if (completed) this.startMove();
    this.bump();
  }

  /**
   * Called by the board once a move has finished playing out. Only now does the turn really
   * pass: the computer starts thinking, or the other player's taps are accepted.
   */
  boardSettled(): void {
    if (!this.moving()) return;
    this.stopMoving();
    void this.maybeTriggerComputer();
  }

  undo(): void {
    if (this.thinking()) return;
    this.controller.undo();
    this.abandonComputerMove();
    this.stopMoving();
    this.updateKindValue = 'reset';
    this.announcement.set('Your last move was taken back.');
    this.bump();
  }

  newGame(partial?: Partial<Settings>): void {
    this.controller.newGame(partial);
    this.abandonComputerMove();
    this.stopMoving();
    this.updateKindValue = 'reset';
    this.announcement.set('New game.');
    this.bump();
    saveSettings(this.controller.settings);
    void this.maybeTriggerComputer();
  }

  updateSettings(partial: Partial<Settings>): void {
    this.controller.updateSettings(partial);
    this.bump();
    saveSettings(this.controller.settings);
    // A reply being worked out under the old strict-mode setting may not be legal any more.
    if (partial.strictMode !== undefined && this.thinking()) {
      this.abandonComputerMove();
      void this.maybeTriggerComputer();
    }
  }

  isHumanTurn(): boolean {
    const settings = this.controller.settings;
    if (settings.mode === 'pvp') return true;
    return this.controller.state.toMove === settings.playerSide;
  }

  private async maybeTriggerComputer(): Promise<void> {
    const settings = this.controller.settings;
    if (settings.mode !== 'computer') return;
    if (this.controller.outcome.kind !== 'ongoing') return;
    if (this.controller.state.toMove === settings.playerSide) return;
    if (this.thinking() || this.moving()) return;

    const request = ++this.aiRequest;
    this.thinking.set(true);
    const reply = await this.ai.chooseMove({
      board: this.controller.state.board,
      side: this.controller.state.toMove,
      options: { difficulty: settings.difficulty, strictMode: settings.strictMode },
    });
    // New game, undo or a strict-mode change while it was thinking: this reply belongs to a
    // position that's gone, and the new one has already been dealt with.
    if (request !== this.aiRequest) return;
    this.thinking.set(false);

    // Only ever play a move that's legal in the current position.
    const move = reply && this.controller.legalMoves.find((m) => sameMove(m, reply));
    if (move) {
      this.controller.applyExternalMove(move);
      this.startMove();
      this.bump();
    }
  }

  /** Forgets the computer's reply still being worked out, if any: it will be ignored. */
  private abandonComputerMove(): void {
    this.aiRequest++;
    this.thinking.set(false);
  }

  private startMove(): void {
    this.updateKindValue = 'move';
    this.moving.set(true);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.boardSettled(), SETTLE_TIMEOUT_MS);
  }

  private stopMoving(): void {
    this.moving.set(false);
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  /**
   * Picks which sound(s) a just-played move gets: a capture plays a hit per piece taken
   * (louder/heavier if the mover is a king), and a captured king additionally layers a
   * triumphant or ominous cue on top, depending on whether the move was ours or the
   * opponent's (in vs-computer mode; there's no "ours" in 1v1, so it stays neutral there).
   */
  private announceMove(move: Move, settings: Settings): void {
    if (move.captures.length === 0) {
      this.audio.moveTap();
    } else if (isKing(move.piece)) {
      this.audio.kingCapture(move.captures.length);
    } else {
      this.audio.capture(move.captures.length);
    }

    if (move.capturedKing) {
      const moverSide = Math.sign(move.piece);
      const moveWasOpponents = settings.mode === 'computer' && moverSide !== settings.playerSide;
      if (moveWasOpponents) this.audio.kingLost();
      else this.audio.kingCaptured();
    }

    if (move.promotes) this.audio.promotion();
  }

  private bump(): void {
    this.version.update((v) => v + 1);
  }
}

/**
 * A move in words, e.g. "Computer played c7 to b6." or "You played c3 takes e5 takes g7,
 * 2 pieces captured, promoted to king." Vs the computer it says "You"/"Computer"; in 1v1
 * it names the side.
 */
export function describeMove(move: Move, settings: Settings): string {
  const side = Math.sign(move.piece);
  const who =
    settings.mode === 'computer'
      ? side === settings.playerSide
        ? 'You'
        : 'Computer'
      : side === LIGHT
        ? 'Light'
        : 'Dark';
  const route = move.path.map(squareName).join(move.captures.length > 0 ? ' takes ' : ' to ');
  const details: string[] = [];
  if (move.captures.length > 1) details.push(`${move.captures.length} pieces captured`);
  if (move.capturedKing) details.push('a king captured');
  if (move.promotes) details.push('promoted to king');
  return `${who} played ${[route, ...details].join(', ')}.`;
}

function sameMove(a: Move, b: Move): boolean {
  return (
    a.path.length === b.path.length &&
    a.path.every((square, i) => square === b.path[i]) &&
    a.captures.length === b.captures.length &&
    a.captures.every((square, i) => square === b.captures[i])
  );
}

export { DARK, LIGHT };
