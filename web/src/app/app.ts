import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Board } from './board/board';
import { AudioService } from './audio/audio.service';
import { GameService } from './game/game.service';
import { DARK, LIGHT, Outcome } from '../engine/types';
import { Difficulty } from '../engine/ai';
import { GameMode, Settings } from './game/game-controller';

@Component({
  selector: 'app-root',
  imports: [Board],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly game = inject(GameService);
  private readonly audio = inject(AudioService);

  protected readonly LIGHT = LIGHT;
  protected readonly DARK = DARK;

  protected readonly flipped = computed(() => {
    const settings = this.game.settings();
    return settings.mode === 'computer' && settings.playerSide === DARK;
  });

  protected readonly selection = computed(() => this.game.selection());

  protected readonly landingDots = computed(() => this.nextSquares(false));
  protected readonly captureRings = computed(() => this.nextSquares(true));

  protected readonly statusText = computed(() => {
    const settings = this.game.settings();
    const state = this.game.state();
    const outcome = this.game.outcome();
    const mustCapture = this.game.selection().compulsorySquares.length > 0;

    if (outcome.kind === 'win') {
      if (settings.mode === 'computer') {
        return outcome.winner === settings.playerSide ? 'You win!' : 'You lose.';
      }
      return `${sideName(outcome.winner)} wins!`;
    }
    if (outcome.kind === 'draw') return 'Draw — 50 moves with no capture.';

    if (this.game.thinking()) return 'Computer is thinking…';

    if (settings.mode === 'computer') {
      if (state.toMove === settings.playerSide) {
        return mustCapture ? 'Your move. You must capture.' : 'Your move.';
      }
      return 'Computer is thinking…';
    }

    const who = sideName(state.toMove);
    return mustCapture ? `${who} to move. You must capture.` : `${who} to move.`;
  });

  protected readonly pieceCounts = computed(() => this.game.pieceCounts());

  protected readonly gameOver = computed(() => describeGameOver(this.game.outcome(), this.game.settings()));

  private nextSquares(wantCaptures: boolean): number[] {
    const selection = this.game.selection();
    if (selection.candidateMoves.length === 0) return [];
    const isCapture = selection.candidateMoves[0].captures.length > 0;
    if (isCapture !== wantCaptures) return [];
    const nextIndex = selection.path.length;
    const squares = selection.candidateMoves.map((m) => m.path[nextIndex]).filter((s) => s !== undefined);
    return [...new Set(squares)];
  }

  onSquareTap(square: number): void {
    this.audio.unlock();
    this.game.tapSquare(square);
  }

  setMode(mode: GameMode): void {
    this.audio.unlock();
    this.game.newGame({ mode });
  }

  setDifficulty(difficulty: Difficulty): void {
    this.audio.unlock();
    this.game.newGame({ difficulty });
  }

  setPlayerSide(playerSide: typeof LIGHT | typeof DARK): void {
    this.audio.unlock();
    this.game.newGame({ playerSide });
  }

  newGame(): void {
    this.audio.unlock();
    this.game.newGame();
  }

  undo(): void {
    this.audio.unlock();
    this.game.undo();
  }

  toggleSound(): void {
    this.audio.unlock();
    this.game.updateSettings({ soundOn: !this.game.settings().soundOn });
  }

  toggleMusic(): void {
    this.audio.unlock();
    this.game.updateSettings({ musicOn: !this.game.settings().musicOn });
  }

  toggleStrictMode(): void {
    this.audio.unlock();
    this.game.updateSettings({ strictMode: !this.game.settings().strictMode });
  }
}

function sideName(side: typeof LIGHT | typeof DARK): string {
  return side === LIGHT ? 'Light' : 'Dark';
}

export interface GameOverInfo {
  variant: 'win' | 'loss' | 'neutral';
  title: string;
  subtitle: string;
}

/** Pure so it's unit-testable without driving a whole game through the UI. */
export function describeGameOver(outcome: Outcome, settings: Settings): GameOverInfo | null {
  if (outcome.kind === 'draw') {
    return {
      variant: 'neutral',
      title: 'Draw',
      subtitle: '50 moves in a row with no capture and no man moving.',
    };
  }
  if (outcome.kind !== 'win') return null;

  if (settings.mode === 'computer') {
    const youWon = outcome.winner === settings.playerSide;
    return {
      variant: youWon ? 'win' : 'loss',
      title: youWon ? 'You win!' : 'You lose',
      subtitle: youWon ? 'The computer has no legal move left.' : 'You have no legal move left.',
    };
  }

  const loser = outcome.winner === LIGHT ? DARK : LIGHT;
  return {
    variant: 'win',
    title: `${sideName(outcome.winner)} wins!`,
    subtitle: `${sideName(loser)} has no legal move left.`,
  };
}
