import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Board } from './board/board';
import { GameSetup, Home } from './home/home';
import { RoomPanel } from './online/room-panel';
import { AudioService } from './audio/audio.service';
import { GameService } from './game/game.service';
import { squareName } from '../engine/board';
import { DARK, LIGHT, Outcome } from '../engine/types';
import { Difficulty } from '../engine/ai';
import { Nfikh, Settings } from './game/game-controller';

@Component({
  selector: 'app-root',
  imports: [Board, Home, RoomPanel],
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
  /** Getting into an online room: the home screen's start button waits. */
  protected readonly homeBusy = signal(false);
  protected readonly homeError = signal<string | null>(null);
  /** A room code from an invite link, `?room=K7QX`. */
  protected readonly inviteCode = signal(inviteCodeFrom(typeof location === 'undefined' ? '' : location.search));

  /** Ticks every 15 s, for "lost connection 3 min ago". */
  private readonly clock = signal(Date.now());

  /** The settings as "you" see them: online, `playerSide` is the side the server gave you. */
  private readonly perspective = computed(() => ({ ...this.game.settings(), playerSide: this.game.playerSide() }));

  protected readonly setupSummary = computed(() => describeSetup(this.perspective()));

  /** Says what a piece taken by nfikh means, while it's still news. */
  protected readonly nfikhNote = computed(() => describeNfikh(this.game.lastNfikh(), this.perspective()));

  protected readonly flipped = computed(() => {
    const settings = this.perspective();
    return settings.mode !== 'pvp' && settings.playerSide === DARK;
  });

  protected readonly selection = computed(() => this.game.selection());

  private readonly gameOverButton = viewChild<ElementRef<HTMLButtonElement>>('gameOverButton');
  private readonly board = viewChild(Board);
  private readonly injector = inject(Injector);

  constructor() {
    // When the game-over card appears, move keyboard (and screen reader) focus to its
    // "New game" button, rather than leaving it on the board behind the card.
    effect(() => this.gameOverButton()?.nativeElement.focus());

    // Each time the home screen is shown, check the online server is there, so its Online
    // button only shows when it is.
    effect(() => {
      if (this.screen() === 'home') untracked(() => void this.game.checkOnlineServer());
    });

    const tick = setInterval(() => this.clock.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));

    // Reloaded during an online game: go straight back into it. (An invite link wins: that's
    // a new room to join.)
    if (!this.inviteCode()) {
      void this.game.resumeOnline().then((back) => {
        if (back) this.screen.set('game');
      });
    }
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
    const settings = this.perspective();
    const state = this.game.state();
    const outcome = this.game.outcome();
    const online = this.game.online();

    if (settings.mode === 'online' && online && outcome.kind === 'ongoing') {
      if (online.connection === 'reconnecting') return 'Connection lost. Reconnecting…';
      if (online.connection === 'lost') return 'This game is no longer on the server. Leave the room to start a new one.';
      if (!online.opponentJoined) return `Waiting for your friend to join room ${online.code}…`;
      if (!online.opponentConnected) return describeOpponentGone(online.opponentGoneSince, this.clock());
      if (this.game.selection().target !== null) return 'More than one way to get there: tap the way to go.';
      return state.toMove === online.side ? 'Your move.' : "Opponent's move.";
    }

    if (outcome.kind === 'win') {
      if (settings.mode !== 'pvp') {
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
    this.game.moving() ? null : describeGameOver(this.game.outcome(), this.perspective()),
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

  async startGame(setup: GameSetup): Promise<void> {
    this.audio.unlock();
    this.homeError.set(null);
    const { online, ...settings } = setup;
    if (!online) {
      this.game.newGame(settings);
      this.screen.set('game');
      return;
    }
    this.homeBusy.set(true);
    const error = await this.game.startOnline(online, settings);
    this.homeBusy.set(false);
    if (error) {
      this.homeError.set(error);
      void this.game.checkOnlineServer(); // it may have gone since the home screen checked
      return;
    }
    if (this.inviteCode()) {
      // Done with the invite: without this, a reload would land on "Join room" again
      // instead of going back into the game.
      this.inviteCode.set(null);
      history.replaceState(null, '', location.pathname);
    }
    this.screen.set('game');
  }

  /** Back to the home screen. An online game is left; Start game begins a fresh one. */
  openMenu(): void {
    this.audio.unlock();
    this.game.leaveOnline();
    this.homeError.set(null);
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sideName(side: typeof LIGHT | typeof DARK): string {
  return side === LIGHT ? 'White' : 'Black';
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  beginner: 'Beginner',
  novice: 'Novice',
  'very-good': 'Very good',
};

/** "Your opponent lost connection 3 min ago. Waiting for them to come back…" */
export function describeOpponentGone(since: number | null, now: number): string {
  const minutes = since === null ? 0 : Math.floor((now - since) / 60_000);
  const when = minutes < 1 ? '' : ` ${minutes} min ago`;
  return `Your opponent lost connection${when}. Waiting for them to come back…`;
}

/** A room code from the page's query string (`?room=K7QX`), or null. */
export function inviteCodeFrom(search: string): string | null {
  const code = new URLSearchParams(search).get('room')?.trim().toUpperCase();
  return code ? code : null;
}

/** One line for the game screen saying what was picked on the home screen. */
export function describeSetup(settings: Settings): string {
  if (settings.mode === 'pvp') return '1v1';
  if (settings.mode === 'online') return `Online · You play ${sideName(settings.playerSide)}`;
  return `Vs computer · ${DIFFICULTY_NAMES[settings.difficulty]} · You play ${sideName(settings.playerSide)}`;
}

/** Pure, like describeGameOver: what to say about a piece just taken by nfikh. */
export function describeNfikh(nfikh: Nfikh | null, settings: Settings): string | null {
  if (!nfikh) return null;
  const square = squareName(nfikh.square);
  if (settings.mode !== 'pvp') {
    const them = settings.mode === 'online' ? 'your opponent' : 'the computer';
    return nfikh.by === settings.playerSide
      ? `Nfikh! You took ${them}'s piece on ${square}: it missed a capture.`
      : `Nfikh! ${capitalize(them)} took your piece on ${square}: you missed a capture.`;
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

  if (settings.mode !== 'pvp') {
    const youWon = outcome.winner === settings.playerSide;
    const them = settings.mode === 'online' ? 'Your opponent' : 'The computer';
    return {
      variant: youWon ? 'win' : 'loss',
      title: youWon ? 'You win!' : 'You lose',
      subtitle: youWon ? `${them} has no legal move left.` : 'You have no legal move left.',
    };
  }

  const loser = outcome.winner === LIGHT ? DARK : LIGHT;
  return {
    variant: 'win',
    title: `${sideName(outcome.winner)} wins!`,
    subtitle: `${sideName(loser)} has no legal move left.`,
  };
}
