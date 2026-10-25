import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { describeMoveTime, RoomPanel } from './online/room-panel';
import { RoomChip } from './online/room-chip';
import { Scoreboard, ScoreboardPlayer } from './scoreboard/scoreboard';
import { CapturedTray } from './scoreboard/captured-tray';
import { MoveList } from './move-list/move-list';
import { ReactionBar } from './reactions/reaction-bar';
import { ReactionBubble } from './reactions/reaction-bubble';
import { Matchmaking } from './matchmaking/matchmaking';
import { ReactionId } from '../protocol/online';
import { OnlinePrompt } from './online/online-prompt';
import { GameOverCard } from './game-over/game-over-card';
import { TapToast } from './tap-toast/tap-toast';
import { AudioService } from './audio/audio.service';
import { GameService, playerName } from './game/game.service';
import { squareName } from '../engine/board';
import { DARK, LIGHT, Outcome, Side } from '../engine/types';
import { MAX_TIMEOUTS } from '../engine/game';
import { RoomResult } from '../protocol/online';
import { Difficulty } from '../engine/ai';
import { Nfikh, Settings } from './game/game-controller';

@Component({
  selector: 'app-root',
  imports: [
    Board,
    Home,
    RoomPanel,
    RoomChip,
    Scoreboard,
    CapturedTray,
    MoveList,
    ReactionBar,
    ReactionBubble,
    Matchmaking,
    TapToast,
    OnlinePrompt,
    GameOverCard,
  ],
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
  protected readonly screen = signal<'home' | 'game' | 'match'>('home');
  /** Getting into an online room: the home screen's start button waits. */
  protected readonly homeBusy = signal(false);
  protected readonly homeError = signal<string | null>(null);
  /** A room code from an invite link, `?room=K7QX`. */
  protected readonly inviteCode = signal(inviteCodeFrom(typeof location === 'undefined' ? '' : location.search));

  /** Ticks every 5 s, for "lost connection 3 min ago" and when a win can be claimed. */
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

  private readonly gameOverCard = viewChild(GameOverCard);
  private readonly board = viewChild(Board);
  private readonly injector = inject(Injector);

  constructor() {
    // When the game-over card appears, move keyboard (and screen reader) focus to its
    // "New game" button, rather than leaving it on the board behind the card.
    effect(() => this.gameOverCard()?.focus());

    // Each time the home screen is shown, check the online server is there, so its Online
    // button only shows when it is.
    effect(() => {
      if (this.screen() === 'home') untracked(() => void this.game.checkOnlineServer());
    });

    // "Play someone" found an opponent: into the game.
    effect(() => {
      if (this.screen() === 'match' && this.game.online()) untracked(() => this.screen.set('game'));
    });

    const tick = setInterval(() => this.clock.set(Date.now()), 5_000);
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
    if (outcome.kind === 'draw') {
      return this.game.endReason() === 'draw_agreed' ? 'Draw by agreement.' : 'Draw — 50 moves with no capture.';
    }

    if (this.game.thinking()) return 'Computer is thinking…';
    if (this.game.selection().target !== null) return 'More than one way to get there: tap the way to go.';

    if (settings.mode === 'computer') {
      return state.toMove === settings.playerSide ? 'Your move.' : 'Computer is thinking…';
    }
    return `${sideName(state.toMove)} to move.`;
  });

  /**
   * The status line says whose move it is, which the scoreboard already shows: then it's
   * only there for screen readers. Anything else it says (thinking, reconnecting, the result)
   * is shown.
   */
  protected readonly statusIsTurn = computed(() => /^(Your move\.|Opponent's move\.|(White|Black) to move\.)$/.test(this.statusText()));

  /** The latest problem the server reported, once both players are in (the room card shows it before). */
  protected readonly onlineError = computed(() => {
    const online = this.game.online();
    return online?.opponentJoined ? online.error : null;
  });

  /** Which message the one line above the board shows: the most important one there is. */
  protected readonly shownMessage = computed<'error' | 'timeout' | 'nfikh' | 'status' | null>(() => {
    if (this.onlineError()) return 'error';
    if (this.timeoutNote()) return 'timeout';
    if (this.nfikhNote()) return 'nfikh';
    return this.statusIsTurn() ? null : 'status';
  });

  /** The scoreboard's two players: you on the left (White on the left in 1v1), then the other. */
  protected readonly scoreboardPlayers = computed<readonly [ScoreboardPlayer, ScoreboardPlayer]>(() => {
    const settings = this.perspective();
    const counts = this.game.pieceCounts();
    const left: Side = settings.mode === 'pvp' ? LIGHT : settings.playerSide;
    const player = (side: Side): ScoreboardPlayer => {
      const name = playerName(side, settings);
      return {
        side,
        name,
        // Every piece starts on the board: what's missing was captured (or taken by nfikh).
        captured: PIECES_PER_SIDE - (side === LIGHT ? counts.dark : counts.light),
        turnLabel: name === 'You' ? 'Your move' : name === 'Computer' ? 'Thinking…' : 'To move',
      };
    };
    return [player(left), player((-left) as Side)];
  });

  /** The side the scoreboard lights up: nobody's while waiting for the friend, or once it's over. */
  protected readonly scoreboardToMove = computed(() => {
    const online = this.game.online();
    if ((online && !online.opponentJoined) || this.game.outcome().kind !== 'ongoing') return null;
    return this.game.state().toMove;
  });

  protected readonly scoreboardClock = computed(() => {
    const clock = this.game.turnClock();
    const left = this.game.turnLeftMs();
    return clock && left !== null ? { side: clock.side, leftMs: left } : null;
  });

  protected readonly moveNumber = computed(() => Math.floor(this.game.plies().length / 2) + 1);

  /** Who plays White and Black, for the move list's columns. */
  protected readonly moveListNames = computed(() => {
    const settings = this.perspective();
    return { light: playerName(LIGHT, settings), dark: playerName(DARK, settings) };
  });

  protected readonly moveTimeNote = computed(() => describeMoveTime(this.game.moveTimeMs()));

  /** Says whose turn was just skipped because their time ran out, until the next move. */
  protected readonly timeoutNote = computed(() =>
    describeTimeout(this.game.lastTimeout(), this.game.state().timeouts, this.perspective(), this.game.outcome().kind === 'ongoing'),
  );

  /**
   * The game-over card, once the move that ended the game has finished playing out on the
   * board: shown straight away, it would hide the winning move (and the moving piece would
   * slide across it).
   */
  protected readonly gameOver = computed(() =>
    this.game.moving() ? null : describeGameOver(this.game.outcome(), this.perspective(), this.game.endReason()),
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
    if (online.kind === 'match') {
      this.screen.set('match');
      await this.game.findMatch(settings);
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

  // ---- Online: ending a game ---------------------------------------------------------

  /** Resign asks "Are you sure?" first: the first tap shows Yes / No. */
  protected readonly confirmingResign = signal(false);
  /** The claim-win moment the player chose to "Keep waiting" past. */
  private readonly claimDismissedAt = signal<number | null>(null);

  /** Online, game on: Resign and Offer draw are available. */
  protected readonly onlineGameOn = computed(() => {
    const online = this.game.online();
    return !!online && online.opponentJoined && online.result === null && this.game.outcome().kind === 'ongoing';
  });

  protected readonly drawOfferToAnswer = computed(() => this.onlineGameOn() && this.game.online()?.drawOffer === 'opponent');

  /** The opponent has been gone long enough that the player may claim the win. */
  protected readonly canClaimWin = computed(() => {
    const online = this.game.online();
    if (!online || !this.onlineGameOn() || online.claimWinAt === null || online.opponentConnected) return false;
    return this.clock() >= online.claimWinAt && this.claimDismissedAt() !== online.claimWinAt;
  });

  resign(): void {
    this.audio.unlock();
    if (!this.confirmingResign()) {
      this.confirmingResign.set(true);
      return;
    }
    this.confirmingResign.set(false);
    this.game.resign();
  }

  cancelResign(): void {
    this.confirmingResign.set(false);
  }

  offerDraw(): void {
    this.audio.unlock();
    this.game.offerDraw();
  }

  answerDraw(accept: boolean): void {
    this.audio.unlock();
    this.game.answerDraw(accept);
  }

  claimWin(): void {
    this.audio.unlock();
    this.game.claimWin();
  }

  keepWaiting(): void {
    this.claimDismissedAt.set(this.game.online()?.claimWinAt ?? null);
  }

  answerRematch(yes: boolean): void {
    this.audio.unlock();
    this.game.askRematch(yes);
  }

  // ---- Quick reactions, and "Play someone" -------------------------------------------

  /** The reactions this design offers during a game. */
  protected readonly reactionChoices: readonly ReactionId[] = ['happy', 'wow', 'oops', 'good-move', 'hurry'];

  /** Who sent the reaction on screen, and which side of the scoreboard it comes from. */
  protected readonly reactionFrom = computed(() => {
    const reaction = this.game.reaction();
    if (!reaction) return null;
    const left = this.scoreboardPlayers()[0].side;
    return { name: playerName(reaction.by, this.perspective()), align: reaction.by === left ? ('left' as const) : ('right' as const) };
  });

  sendReaction(reaction: ReactionId): void {
    this.audio.unlock();
    this.game.sendReaction(reaction);
  }

  cancelMatch(): void {
    this.game.cancelMatch();
    this.screen.set('home');
  }

  playComputerInstead(): void {
    this.game.cancelMatch();
    this.game.newGame({ mode: 'computer' });
    this.screen.set('game');
  }

  /** The numbers on the game-over screen, from your side (the winner's in 1v1). */
  protected readonly gameOverStats = computed(() => {
    const stats = this.game.stats();
    const settings = this.perspective();
    const outcome = this.game.outcome();
    const side = settings.mode === 'pvp' ? (outcome.kind === 'win' ? outcome.winner : LIGHT) : settings.playerSide;
    const counts = this.game.pieceCounts();
    const seconds = Math.max(0, Math.round(stats.durationMs / 1000));
    return {
      taken: PIECES_PER_SIDE - (side === LIGHT ? counts.dark : counts.light),
      moves: stats.moves,
      time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      bestCombo: side === LIGHT ? stats.bestCombo.light : stats.bestCombo.dark,
    };
  });

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

/** How many pieces each side starts with. */
const PIECES_PER_SIDE = 20;

/**
 * Pure, like describeNfikh: what to say about a turn just skipped because time ran out, e.g.
 * "Opponent ran out of time: your move again." With the count of time-outs in a row, as
 * three lose the game.
 */
export function describeTimeout(
  side: Side | null,
  timeouts: { light: number; dark: number },
  settings: Settings,
  gameOn = true,
): string | null {
  if (side === null || !gameOn) return null;
  const count = side === LIGHT ? timeouts.light : timeouts.dark;
  const inARow = `Time-outs in a row: ${count} of ${MAX_TIMEOUTS}.`;
  if (settings.mode === 'pvp') {
    return `${sideName(side)} ran out of time: ${sideName((-side) as Side)} to move. ${inARow}`;
  }
  return side === settings.playerSide
    ? `You ran out of time: your turn was skipped. ${inARow}`
    : `${playerName(side, settings)} ran out of time: your move again. ${inARow}`;
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

/**
 * Pure so it's unit-testable without driving a whole game through the UI. `reason`: how an
 * online game ended other than on the board (resigned, agreed draw, claimed win).
 */
export function describeGameOver(
  outcome: Outcome,
  settings: Settings,
  reason: RoomResult['kind'] | null = null,
): GameOverInfo | null {
  if (outcome.kind === 'draw') {
    return {
      variant: 'neutral',
      title: 'Draw',
      subtitle: reason === 'draw_agreed' ? 'Draw by agreement.' : '50 moves in a row with no capture and no man moving.',
    };
  }
  if (outcome.kind !== 'win') return null;

  if (settings.mode !== 'pvp') {
    const youWon = outcome.winner === settings.playerSide;
    const them = settings.mode === 'online' ? 'Your opponent' : 'The computer';
    const subtitle = outcome.onTime
      ? youWon
        ? `${them} ran out of time ${MAX_TIMEOUTS} turns in a row.`
        : `You ran out of time ${MAX_TIMEOUTS} turns in a row.`
      : reason === 'resigned'
        ? youWon
          ? 'Your opponent resigned.'
          : 'You resigned.'
        : reason === 'abandoned'
          ? youWon
            ? "Your opponent didn't come back."
            : "You didn't come back in time."
          : youWon
            ? `${them} has no legal move left.`
            : 'You have no legal move left.';
    return { variant: youWon ? 'win' : 'loss', title: youWon ? 'You win!' : 'You lose', subtitle };
  }

  const loser = outcome.winner === LIGHT ? DARK : LIGHT;
  return {
    variant: 'win',
    title: `${sideName(outcome.winner)} wins!`,
    subtitle: outcome.onTime ? `${sideName(loser)} ran out of time ${MAX_TIMEOUTS} turns in a row.` : `${sideName(loser)} has no legal move left.`,
  };
}
