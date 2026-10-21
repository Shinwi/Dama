import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Board } from './board/board';
import { GameSetup, Home } from './home/home';
import { AudioService } from './audio/audio.service';
import { GameService } from './game/game.service';
import { squareName } from '../engine/board';
import { DARK, LIGHT, Outcome } from '../engine/types';
import { Difficulty } from '../engine/ai';
import { Nfikh, Settings } from './game/game-controller';

@Component({
  selector: 'app-root',
  imports: [Board, Home],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly game = inject(GameService);
  private readonly audio = inject(AudioService);

  protected readonly LIGHT = LIGHT;
  protected readonly DARK = DARK;

  /** The home screen comes first; Start game (or Menu, from the game) switches between them. */
  protected readonly screen = signal<'home' | 'game'>('home');

  protected readonly setupSummary = computed(() => describeSetup(this.game.settings()));

  /** Says what a piece taken by nfikh means, while it's still news. */
  protected readonly nfikhNote = computed(() => describeNfikh(this.game.lastNfikh(), this.game.settings()));

  protected readonly flipped = computed(() => {
    const settings = this.game.settings();
    return settings.mode === 'computer' && settings.playerSide === DARK;
  });

  protected readonly selection = computed(() => this.game.selection());

  private readonly gameOverButton = viewChild<ElementRef<HTMLButtonElement>>('gameOverButton');
  private readonly board = viewChild(Board);
  private readonly injector = inject(Injector);

  constructor() {
    // When the game-over card appears, move keyboard (and screen reader) focus to its
    // "New game" button, rather than leaving it on the board behind the card.
    effect(() => this.gameOverButton()?.nativeElement.focus());
  }

  /** Pieces jumped so far by a multi-jump that's still being tapped out, hop by hop. */
  protected readonly capturedSoFar = computed(() => {
    const { path, candidateMoves } = this.game.selection();
    if (path.length < 2 || candidateMoves.length === 0) return [];
    return candidateMoves[0].captures.slice(0, path.length - 1);
  });

  protected readonly landingDots = computed(() => this.nextSquares(false));
  protected readonly captureRings = computed(() => this.nextSquares(true));

  protected readonly statusText = computed(() => {
    const settings = this.game.settings();
    const state = this.game.state();
    const outcome = this.game.outcome();

    if (outcome.kind === 'win') {
      if (settings.mode === 'computer') {
        return outcome.winner === settings.playerSide ? 'You win!' : 'You lose.';
      }
      return `${sideName(outcome.winner)} wins!`;
    }
    if (outcome.kind === 'draw') return 'Draw — 50 moves with no capture.';

    if (this.game.thinking()) return 'Computer is thinking…';
    if (this.game.selection().target !== null) return 'More than one way to get there: tap the way to go.';

    if (settings.mode === 'computer') {
      return state.toMove === settings.playerSide ? 'Your move.' : 'Computer is thinking…';
    }
    return `${sideName(state.toMove)} to move.`;
  });

  protected readonly pieceCounts = computed(() => this.game.pieceCounts());

  /**
   * The game-over card, once the move that ended the game has finished playing out on the
   * board: shown straight away, it would hide the winning move (and the moving piece would
   * slide across it).
   */
  protected readonly gameOver = computed(() =>
    this.game.moving() ? null : describeGameOver(this.game.outcome(), this.game.settings()),
  );

  /**
   * Where the selected piece can be sent: the square each move ends on, however many jumps
   * it takes to get there. While choosing between routes to the same square, the squares
   * where the routes split instead.
   */
  private nextSquares(wantCaptures: boolean): number[] {
    const selection = this.game.selection();
    // Captures are optional, so a piece can have both kinds of move: dots for plain moves,
    // rings for captures.
    const moves = selection.candidateMoves.filter((m) => m.captures.length > 0 === wantCaptures);
    if (selection.target === null) {
      return [...new Set(moves.map((m) => m.to))];
    }
    const nextIndex = selection.path.length;
    const squares = moves.map((m) => m.path[nextIndex] ?? m.to);
    return [...new Set(squares)];
  }

  onSquareTap(square: number): void {
    this.audio.unlock();
    this.game.tapSquare(square);
  }

  startGame(setup: GameSetup): void {
    this.audio.unlock();
    this.game.newGame(setup);
    this.screen.set('game');
  }

  /** Back to the home screen. The game is set aside; Start game begins a fresh one. */
  openMenu(): void {
    this.audio.unlock();
    this.screen.set('home');
  }

  newGame(): void {
    this.audio.unlock();
    this.game.newGame();
  }

  /**
   * "New game" on the game-over card. The card (and the focused button with it) goes away, so
   * put focus back on the board; otherwise it falls to the page, and the next Tab skips past
   * the board to the sidebar.
   */
  newGameFromGameOver(): void {
    this.newGame();
    afterNextRender(() => this.board()?.focus(), { injector: this.injector });
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
  return side === LIGHT ? 'White' : 'Black';
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  beginner: 'Beginner',
  novice: 'Novice',
  'very-good': 'Very good',
};

/** One line for the game screen saying what was picked on the home screen. */
export function describeSetup(settings: Settings): string {
  if (settings.mode === 'pvp') return '1v1';
  return `Vs computer · ${DIFFICULTY_NAMES[settings.difficulty]} · You play ${sideName(settings.playerSide)}`;
}

/** Pure, like describeGameOver: what to say about a piece just taken by nfikh. */
export function describeNfikh(nfikh: Nfikh | null, settings: Settings): string | null {
  if (!nfikh) return null;
  const square = squareName(nfikh.square);
  if (settings.mode === 'computer') {
    return nfikh.by === settings.playerSide
      ? `Nfikh! You took the computer's piece on ${square}: it missed a capture.`
      : `Nfikh! The computer took your piece on ${square}: you missed a capture.`;
  }
  const loser = nfikh.by === LIGHT ? DARK : LIGHT;
  return `Nfikh! ${sideName(nfikh.by)} took ${sideName(loser)}'s piece on ${square}: it missed a capture.`;
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
