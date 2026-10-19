import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AiClient } from '../ai/ai-client';
import { AudioService } from '../audio/audio.service';
import { isKing } from '../../engine/board';
import { DARK, LIGHT, Move, Outcome } from '../../engine/types';
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
  private lastAnnouncedOutcome: Outcome | null = null;
  private updateKindValue: 'reset' | 'move' = 'reset';

  readonly thinking = signal(false);
  /** A move is still playing out on the board: nobody can move until it has landed. */
  readonly moving = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

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
        if (justPlayed) this.announceMove(move, settings);
      }
    });

    effect(() => {
      const outcome = this.outcome();
      const settings = this.settings();
      if (outcome.kind === 'win' && outcome !== this.lastAnnouncedOutcome) {
        this.lastAnnouncedOutcome = outcome;
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
    this.stopMoving();
    this.updateKindValue = 'reset';
    this.bump();
  }

  newGame(partial?: Partial<Settings>): void {
    this.controller.newGame(partial);
    this.stopMoving();
    this.updateKindValue = 'reset';
    this.bump();
    saveSettings(this.controller.settings);
    void this.maybeTriggerComputer();
  }

  updateSettings(partial: Partial<Settings>): void {
    this.controller.updateSettings(partial);
    this.bump();
    saveSettings(this.controller.settings);
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

    this.thinking.set(true);
    const move = await this.ai.chooseMove({
      board: this.controller.state.board,
      side: this.controller.state.toMove,
      options: { difficulty: settings.difficulty, strictMode: settings.strictMode },
    });
    this.thinking.set(false);

    if (move) {
      this.controller.applyExternalMove(move);
      this.startMove();
      this.bump();
    }
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

export { DARK, LIGHT };
