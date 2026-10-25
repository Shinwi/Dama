import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AiClient } from '../ai/ai-client';
import { AudioService } from '../audio/audio.service';
import { OnlineClient, onlineServerInfo, onlineServerUrl, playersOnline, ServerFeature } from '../online/online-client';
import { playerId } from '../online/player-id';
import { Seat, SeatStore } from '../online/seat-store';
import { isKing, squareName } from '../../engine/board';
import { DARK, GameState, LIGHT, Move, Outcome, Side } from '../../engine/types';
import { ActionReply, OnlineAction, ReactionId, RoomAction, RoomResult, RoomView, WireState } from '../../protocol/online';
import { defaultSettings, GameController, RejectReason, Settings, UpdateKind } from './game-controller';

const STORAGE_KEY = 'dama.settings.v1';
/** Backstop in case the board never reports a move as settled: no animation is this long. */
const SETTLE_TIMEOUT_MS = 5000;
/** When the computer takes a piece by nfikh, how long it pauses before making its move. */
const NFIKH_PAUSE_MS = 600;
/** After a reconnect, how long to wait before asking for the seat again if the server didn't answer. */
const REJOIN_RETRY_MS = 2000;
/** How often the move timer's countdown is updated on screen. */
const CLOCK_TICK_MS = 250;
/** The last stretch of a turn, when the clock turns red and ticks. */
export const LOW_TIME_MS = 10_000;

/** How long a quick reaction stays on screen. */
const REACTION_SHOW_MS = 3000;
/** The shortest gap between two reactions from the same player, so nobody can spam them. */
const REACTION_COOLDOWN_MS = 1500;
/** How long the computer takes to react back. */
const COMPUTER_REACTION_DELAY_MS = 1200;
/** How long a combo ("Double jump!") stays up. */
const COMBO_SHOW_MS = 1800;

/** What the computer says back to each reaction. */
const COMPUTER_ANSWERS: Record<ReactionId, ReactionId> = {
  happy: 'happy',
  laugh: 'laugh',
  wow: 'cheeky',
  oops: 'laugh',
  grumpy: 'cheeky',
  cheeky: 'cheeky',
  thinking: 'take-your-time',
  'good-move': 'happy',
  hurry: 'thinking',
  'take-your-time': 'happy',
  'good-game': 'good-game',
  'well-played': 'good-game',
  'one-more': 'happy',
};

/** A quick reaction on screen: who sent it, and which. */
export interface ShownReaction {
  by: Side;
  reaction: ReactionId;
  /** Different for every reaction, so the same one twice still shows again. */
  id: number;
}

/** A move that took two or more pieces, while it's news: who played it and how many it took. */
export interface Combo {
  by: Side;
  count: number;
  id: number;
}

/** "Play someone": looking for a random opponent. */
export interface MatchmakingStatus {
  /** When (Date.now()) the search started. */
  since: number;
  /** 'unavailable': this server can't match players yet; 'error': it refused. */
  state: 'searching' | 'unavailable' | 'error';
  error?: string;
}

/** The numbers on the game-over screen. */
export interface GameStats {
  /** Moves played by both sides (skipped turns not counted). */
  moves: number;
  /** The most pieces one move took, per side. */
  bestCombo: { light: number; dark: number };
  /** From the first move's turn to the end (or now, while the game is on). */
  durationMs: number;
}

/** The move timer for the turn being played. */
export interface TurnClock {
  /** Whose turn it is. */
  side: Side;
  /** When (Date.now()) the time runs out. */
  deadline: number;
  /** The whole time for a turn. */
  totalMs: number;
}

/** Where this player is in an online game, for the screen. Null when not playing online. */
export interface OnlineStatus {
  code: string;
  side: Side;
  opponentJoined: boolean;
  opponentConnected: boolean;
  /**
   * 'reconnecting' from the moment the connection drops until the server has confirmed this
   * player is back in their seat; 'lost' if the server no longer has the game (it restarted).
   */
  connection: 'connected' | 'reconnecting' | 'lost';
  /** The latest problem to tell the player about (e.g. a move the server refused). */
  error: string | null;
  /** When (Date.now()) the opponent was seen to lose their connection, while they're gone. */
  opponentGoneSince: number | null;
  /** Which game in the room this is: a rematch starts the next one. */
  game: number;
  /** Set when the game ended by resigning, an agreed draw, or a claimed win. */
  result: RoomResult | null;
  /** An open draw offer: made by you, or by your opponent (yours to answer). */
  drawOffer: 'you' | 'opponent' | null;
  /** After the game: who has asked for a rematch. */
  rematch: { you: boolean; opponent: boolean };
  /** When (Date.now()) the player may claim the win, while the opponent is gone; else null. */
  claimWinAt: number | null;
  /** The room's move timer, or 0 for none. */
  moveTimeMs: number;
}

/** A refused tap, for the board (a shake) and a short message. */
export interface TapFeedback {
  /** The square tapped. */
  square: number;
  /** The square of the piece to shake (the selected one, or the one tapped), or null. */
  shake: number | null;
  message: string;
  /** Different for every refusal, so the same square can shake twice in a row. */
  id: number;
}

/**
 * What to say about a refused tap. Only what's at the tapped square, never what to do instead:
 * the game gives no hints (which piece can capture, which can be taken by nfikh).
 */
const REJECT_MESSAGES: Record<RejectReason, string> = {
  empty: 'Pick one of your pieces first.',
  unreachable: "That piece can't go there.",
  opponent: "You can't take that piece.",
  stuck: "That piece can't move.",
  route: 'Tap a marked square to choose the way.',
};

/** How long a refused tap's message stays up. */
const TAP_FEEDBACK_MS = 1800;

/** Whether the online server answered the last check. 'checking' only until the first answer. */
export type OnlineServerState = 'checking' | 'up' | 'down';

/** How to get into an online room, from the home screen. */
/** 'match': "Play someone", a random opponent (GameService.findMatch, not startOnline). */
export type OnlineEntry = { kind: 'create' } | { kind: 'join'; code: string } | { kind: 'match' };


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
  private updateKindValue: UpdateKind = 'reset';

  readonly thinking = signal(false);
  /** The latest refused tap, while its message is up. */
  readonly tapFeedback = signal<TapFeedback | null>(null);
  private feedbackCount = 0;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** What just happened (a move, Undo, New game) in words, for screen readers to announce. */
  readonly announcement = signal('');
  /** A move is still playing out on the board: nobody can move until it has landed. */
  readonly moving = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped for every question put to the computer, and to abandon the one in flight. */
  private aiRequest = 0;
  /** Taps made while a move was still playing out, played once it has (issue #32). */
  private queuedTaps: number[] = [];

  /** The move timer for the turn being played; null while no clock runs. */
  readonly turnClock = signal<TurnClock | null>(null);
  /** Time left on `turnClock`, updated a few times a second; null while no clock runs. */
  readonly turnLeftMs = signal<number | null>(null);
  private clockTicker: ReturnType<typeof setInterval> | null = null;
  /** The last whole second a "hurry up" tick was played for. */
  private tickedSecond: number | null = null;

  /** Made when an online game starts; replaceable in tests. */
  private onlineClientFactory = () => new OnlineClient(onlineServerUrl(), playerId());
  private onlineClient: OnlineClient | null = null;
  /** The seat in the room being played. Every action is sent with it. */
  private onlineSession: Seat | null = null;
  /** Every seat this browser holds, kept across closing the page (see SeatStore). */
  private seats = new SeatStore();
  /** Replaceable in tests. */
  private now = () => Date.now();
  /** How many of the room's actions this copy of the game has played (RoomView.seq). */
  private onlineSeq = 0;
  /**
   * The player's own action the server hasn't confirmed yet, and the room's `seq` before it.
   * If the connection drops, the server may never get it: then it's sent again on rejoin.
   */
  private pendingAction: { action: OnlineAction; seqBefore: number } | null = null;
  readonly online = signal<OnlineStatus | null>(null);
  readonly onlineServer = signal<OnlineServerState>('checking');
  /** Replaceable in tests. Null (or false) when the server isn't there. */
  private onlineServerProbe: (url: string) => Promise<{ features: ServerFeature[] } | null | boolean> = (url) => onlineServerInfo(url);
  private playersOnlineProbe = (url: string) => playersOnline(url);
  /** What the online server can do beyond rooms ('reactions', 'matchmaking'), from its last check. */
  readonly serverFeatures = signal<ServerFeature[]>([]);
  /** How many players are in rooms on the server, from the last check; null if unknown. */
  readonly playersOnline = signal<number | null>(null);

  /** The quick reaction on screen, if any. */
  readonly reaction = signal<ShownReaction | null>(null);
  private reactionCount = 0;
  private reactionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReactionSentAt = Number.NEGATIVE_INFINITY;

  /** A move that took two or more pieces, while it's news. */
  readonly combo = signal<Combo | null>(null);
  private comboTimer: ReturnType<typeof setTimeout> | null = null;

  /** "Play someone", while looking for an opponent; null otherwise. */
  readonly matchmaking = signal<MatchmakingStatus | null>(null);

  /** When the game being played started, and ended (null while it's on). */
  private readonly gameTimes = signal<{ startedAt: number; endedAt: number | null }>({ startedAt: Date.now(), endedAt: null });
  /** Bumped for every check, so only the latest one's answer counts. */
  private onlineServerChecks = 0;

  /** The side "you" play: the server's say online, the setting vs the computer. */
  readonly playerSide = computed(() => this.online()?.side ?? this.settings().playerSide);

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
   * `lastMove()` (so it can slide the piece hop by hop), by taking a piece by nfikh (it fades
   * out), or is an unrelated jump — new game or undo — that should just snap to the new
   * position with no animation.
   */
  readonly updateKind = computed(() => {
    this.version();
    return this.updateKindValue;
  });
  readonly selection = computed(() => {
    this.version();
    return this.controller.selectionInfo;
  });
  /**
   * How the game stands. Online, the server's result (resigned, agreed draw, claimed win) ends
   * the game too, though the board alone wouldn't say so.
   */
  readonly outcome = computed<Outcome>(() => {
    this.version();
    const result = this.online()?.result;
    if (result) return result.winner === null ? { kind: 'draw' } : { kind: 'win', winner: result.winner };
    return this.controller.outcome;
  });
  /** Why an online game ended, when it wasn't on the board. */
  readonly endReason = computed(() => this.online()?.result?.kind ?? null);
  readonly pieceCounts = computed(() => {
    this.version();
    return this.controller.pieceCounts;
  });
  readonly lastNfikh = computed(() => {
    this.version();
    return this.controller.lastNfikh;
  });
  readonly canUndo = computed(() => {
    this.version();
    return this.controller.canUndo();
  });
  /** Every turn played so far, for the move list. */
  readonly plies = computed(() => {
    this.version();
    return this.controller.plies;
  });
  /** The side whose turn was just skipped because its time ran out, until the next move. */
  readonly lastTimeout = computed(() => {
    this.version();
    return this.controller.lastTimeout;
  });
  /** How long each turn may take, in ms; 0 for no timer. Online, the room's setting. */
  readonly moveTimeMs = computed(() => {
    const online = this.online();
    return online ? online.moveTimeMs : this.settings().moveTime * 1000;
  });

  /**
   * Whether quick reactions can be sent: always vs the computer and in 1v1; online once the
   * opponent is in, if the server passes reactions on.
   */
  readonly reactionsAvailable = computed(() => {
    const online = this.online();
    if (!online) return true;
    return this.serverFeatures().includes('reactions') && online.opponentJoined && online.connection === 'connected';
  });

  /** The numbers for the game-over screen. */
  readonly stats = computed<GameStats>(() => {
    const plies = this.plies();
    const bestCombo = { light: 0, dark: 0 };
    let moves = 0;
    for (const ply of plies) {
      if (!ply.move) continue;
      moves++;
      const key = ply.side === LIGHT ? 'light' : 'dark';
      bestCombo[key] = Math.max(bestCombo[key], ply.move.captures.length);
    }
    const { startedAt, endedAt } = this.gameTimes();
    return { moves, bestCombo, durationMs: (endedAt ?? this.now()) - startedAt };
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
      const settings = this.perspective();
      // Undo brings back an older `lastMove`, but nothing was just played: no sound for it.
      const justPlayed = this.updateKind() === 'move';
      if (move && move !== this.lastAnnouncedMove) {
        this.lastAnnouncedMove = move;
        if (justPlayed) {
          this.announceMove(move, settings);
          this.announcement.set(describeMove(move, settings));
          untracked(() => this.moveFeedback(move, settings));
        }
      }
    });

    effect(() => {
      const outcome = this.outcome();
      const settings = this.perspective();
      // `outcome()` is a fresh object on every update, so compare what it says, not identity:
      // only the move that ends the game plays the jingle, not every tap or toggle after it.
      const justEnded = outcome.kind !== 'ongoing' && !this.wasOver;
      this.wasOver = outcome.kind !== 'ongoing';
      if (justEnded) {
        untracked(() => {
          this.gameTimes.update((times) => ({ ...times, endedAt: this.now() }));
          // The computer is a good sport.
          if (settings.mode === 'computer') this.computerReacts('good-game');
        });
      }
      if (justEnded && outcome.kind === 'win') {
        const playerLost = settings.mode !== 'pvp' && outcome.winner !== settings.playerSide;
        if (playerLost) this.audio.loss();
        else this.audio.win();
      }
    });
    // No game starts on its own: the home screen starts one with newGame().
  }

  tapSquare(square: number): void {
    // A move is still playing out: this tap waits for it to land (see boardSettled).
    if (this.moving()) {
      this.queuedTaps.push(square);
      return;
    }
    if (this.thinking() || !this.isHumanTurn()) {
      if (this.controller.outcome.kind === 'ongoing') this.rejectTap(square, null, this.waitMessage());
      return;
    }
    const result = this.controller.tapSquare(square);
    if (result === 'move') this.startMove();
    if (result === 'nfikh') this.showNfikh();
    if (result === 'illegal') {
      const { reason } = this.controller.rejection!;
      // Shake the piece the player meant to move: the selected one, or the one tapped.
      const shake = this.controller.selectionInfo.selected ?? (this.controller.state.board[square] !== 0 ? square : null);
      this.rejectTap(square, shake, REJECT_MESSAGES[reason]);
    }
    this.bump();
    if ((result === 'move' || result === 'nfikh') && this.online()) this.sendOnline(result);
  }

  /** Why it isn't the player's turn to tap, in a few words. */
  private waitMessage(): string {
    const online = this.online();
    if (online) {
      if (online.connection !== 'connected') return 'Reconnecting… one moment.';
      if (!online.opponentJoined) return 'Wait for your friend to join.';
      return "Wait for your opponent's move.";
    }
    return "Wait for the computer's move.";
  }

  /**
   * A refused tap: a short "nope" sound, the piece shakes (if there is one to shake), and a
   * few words say what's wrong. The message goes away by itself.
   */
  private rejectTap(square: number, shake: number | null, message: string): void {
    const feedback: TapFeedback = { square, shake, message, id: ++this.feedbackCount };
    this.tapFeedback.set(feedback);
    this.audio.nope();
    if (this.feedbackTimer !== null) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      if (this.tapFeedback() === feedback) this.tapFeedback.set(null);
    }, TAP_FEEDBACK_MS);
  }

  /**
   * Called by the board once a move has finished playing out. Only now does the turn really
   * pass: the computer starts thinking, or the other player's taps are accepted.
   */
  boardSettled(): void {
    if (!this.moving()) return;
    this.stopMoving();
    // Taps made in the meantime, in order, until one of them starts another move: the rest
    // then wait for that one to land.
    while (this.queuedTaps.length > 0 && !this.moving()) this.tapSquare(this.queuedTaps.shift()!);
    this.restartClock();
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
    this.restartClock();
  }

  /** A new offline game (vs the computer or 1v1). Leaves the online room, if in one. */
  newGame(partial?: Partial<Settings>): void {
    this.leaveOnline();
    this.controller.newGame(partial);
    this.abandonComputerMove();
    this.stopMoving();
    this.updateKindValue = 'reset';
    this.announcement.set('New game.');
    this.startGameTimes();
    this.bump();
    saveSettings(this.controller.settings);
    this.restartClock();
    void this.maybeTriggerComputer();
  }

  updateSettings(partial: Partial<Settings>): void {
    // Online, the rules were fixed when the room was made: both players play the same game.
    if (this.online() && partial.strictMode !== undefined) {
      const { strictMode: _ignored, ...rest } = partial;
      partial = rest;
    }
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
    if (settings.mode === 'online') {
      const online = this.online();
      return (
        !!online &&
        online.opponentJoined &&
        online.connection === 'connected' &&
        online.result === null &&
        this.controller.state.toMove === online.side
      );
    }
    return this.controller.state.toMove === settings.playerSide;
  }

  /**
   * Creates or joins an online room. Resolves with an error to show the player, or null once
   * they're in the room (which may still be waiting for the friend to join).
   */
  async startOnline(entry: OnlineEntry, partial: Partial<Settings> = {}): Promise<string | null> {
    this.leaveOnline();
    this.controller.updateSettings(partial);
    saveSettings(this.controller.settings);

    const client = this.connectOnline();
    const settings = this.controller.settings;

    // A room this browser already has a seat in (e.g. Safari was closed mid-game): take the
    // seat back, rather than ask to join and be told the room is full.
    const ownSeat = entry.kind === 'join' ? this.seats.seatIn(entry.code) : null;
    if (ownSeat) {
      const back = await client.rejoin(ownSeat.code, ownSeat.token);
      if (client !== this.onlineClient) return 'Cancelled.';
      if (back.ok) {
        this.setSession(ownSeat);
        this.enterRoom(back.view);
        return null;
      }
      if ('unreachable' in back) {
        this.leaveOnline();
        return back.error;
      }
      this.seats.forget(ownSeat.code); // that game is over: try joining as a new player
    }

    const reply =
      entry.kind === 'create'
        ? await client.create(settings.playerSide, settings.strictMode, settings.moveTime)
        : await client.join(entry.kind === 'join' ? entry.code : '');
    if (client !== this.onlineClient) return 'Cancelled.'; // left again before the server answered
    if (!reply.ok) {
      this.leaveOnline();
      return reply.error;
    }
    this.setSession({ code: reply.view.code, token: reply.token });
    this.enterRoom(reply.view);
    return null;
  }

  /**
   * Back into the game this browser was playing when the page was reloaded or closed, if
   * there was one and the player didn't leave it. Resolves true if so.
   */
  async resumeOnline(): Promise<boolean> {
    const seat = this.seats.current();
    if (!seat) return false;
    const client = this.connectOnline();
    const reply = await client.rejoin(seat.code, seat.token);
    if (client !== this.onlineClient) return false;
    if (!reply.ok) {
      this.leaveOnline();
      // The room is gone: forget the seat. (Unreachable: keep it, the server may be back later.)
      if (!('unreachable' in reply)) this.seats.forget(seat.code);
      return false;
    }
    this.setSession(seat);
    this.enterRoom(reply.view);
    return true;
  }

  /**
   * Asks whether the online server is there, for the home screen's Online button. Until the
   * answer comes back, the previous one stands (so the button doesn't flicker on a re-check).
   */
  async checkOnlineServer(): Promise<void> {
    const check = ++this.onlineServerChecks;
    const url = onlineServerUrl();
    const info = await this.onlineServerProbe(url);
    if (check !== this.onlineServerChecks) return;
    this.onlineServer.set(info ? 'up' : 'down');
    this.serverFeatures.set(info && typeof info === 'object' ? info.features : []);
    if (info) {
      const players = await this.playersOnlineProbe(url);
      if (check === this.onlineServerChecks) this.playersOnline.set(players);
    }
  }

  // ---- Quick reactions -----------------------------------------------------------------

  /**
   * Sends a quick reaction (shown at once). Vs the computer, it answers; in 1v1 it comes from
   * the side to move; online the server passes it on. Ignored if sent too soon after the last.
   */
  sendReaction(reaction: ReactionId): void {
    if (!this.reactionsAvailable()) return;
    const now = this.now();
    if (now - this.lastReactionSentAt < REACTION_COOLDOWN_MS) return;
    this.lastReactionSentAt = now;
    const settings = this.controller.settings;
    this.showReaction(settings.mode === 'pvp' ? this.controller.state.toMove : this.playerSide(), reaction);
    if (settings.mode === 'computer') this.computerReacts(COMPUTER_ANSWERS[reaction]);
    const client = this.onlineClient;
    const seat = this.onlineSession;
    if (this.online() && client && seat) void client.react(seat.code, seat.token, reaction);
  }

  private showReaction(by: Side, reaction: ReactionId): void {
    const shown: ShownReaction = { by, reaction, id: ++this.reactionCount };
    this.reaction.set(shown);
    if (this.reactionTimer !== null) clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => {
      if (this.reaction() === shown) this.reaction.set(null);
    }, REACTION_SHOW_MS);
  }

  /** Vs the computer: it reacts, after a beat, unless a new game started meanwhile. */
  private computerReacts(reaction: ReactionId): void {
    const computer = (-this.controller.settings.playerSide) as Side;
    const game = this.gameTimes();
    setTimeout(() => {
      if (this.controller.settings.mode === 'computer' && this.gameTimes() === game) this.showReaction(computer, reaction);
    }, COMPUTER_REACTION_DELAY_MS);
  }

  /** After a move: a combo for a multi-capture, and the computer's two cents on it. */
  private moveFeedback(move: Move, settings: Settings): void {
    if (move.captures.length < 2) return;
    const by = Math.sign(move.piece) as Side;
    const combo: Combo = { by, count: move.captures.length, id: ++this.reactionCount };
    this.combo.set(combo);
    if (this.comboTimer !== null) clearTimeout(this.comboTimer);
    this.comboTimer = setTimeout(() => {
      if (this.combo() === combo) this.combo.set(null);
    }, COMBO_SHOW_MS);
    if (settings.mode === 'computer') this.computerReacts(by === settings.playerSide ? 'wow' : 'cheeky');
  }

  private startGameTimes(): void {
    this.gameTimes.set({ startedAt: this.now(), endedAt: null });
    this.reaction.set(null);
    this.combo.set(null);
  }

  // ---- "Play someone" ---------------------------------------------------------------------

  /**
   * Looks for a random opponent on the server. Once one turns up, the game starts as an
   * online room (online() is set). If this server can't match players yet, says so instead.
   */
  async findMatch(partial: Partial<Settings> = {}): Promise<void> {
    this.leaveOnline();
    this.controller.updateSettings(partial);
    saveSettings(this.controller.settings);
    const since = this.now();
    if (!this.serverFeatures().includes('matchmaking')) {
      this.matchmaking.set({ since, state: 'unavailable' });
      return;
    }
    const client = this.connectOnline();
    client.onMatchFound = ({ token, view }) => {
      if (client !== this.onlineClient) return;
      this.matchmaking.set(null);
      this.setSession({ code: view.code, token });
      this.enterRoom(view);
    };
    this.matchmaking.set({ since, state: 'searching' });
    const reply = await client.findMatch(this.controller.settings.moveTime);
    if (client !== this.onlineClient || reply.ok) return;
    this.leaveOnline();
    this.matchmaking.set({ since, state: 'error', error: reply.error });
  }

  /** Stops looking for an opponent. */
  cancelMatch(): void {
    this.onlineClient?.cancelMatch();
    this.leaveOnline();
  }

  /**
   * Leaves the online room, if in one. The friend sees this player as disconnected. The seat
   * is kept, so joining the same code again takes it back; but opening the site again no
   * longer jumps into this game.
   */
  leaveOnline(): void {
    this.pendingAction = null;
    this.onlineClient?.close();
    this.onlineClient = null;
    this.online.set(null);
    this.onlineSession = null;
    this.seats.leave();
    this.setClock(null);
    this.matchmaking.set(null);
  }

  private setSession(seat: Seat): void {
    this.onlineSession = seat;
    this.seats.enter(seat);
  }

  /** The server doesn't have this game any more: forget its seat. */
  private gameGone(error: string): void {
    this.updateOnline({ connection: 'lost', error });
    if (this.onlineSession) this.seats.forget(this.onlineSession.code);
  }

  private connectOnline(): OnlineClient {
    const client = this.onlineClientFactory();
    this.onlineClient = client;
    client.onUpdate = (view) => {
      if (client === this.onlineClient && this.online()) this.applyRoomView(view, false);
    };
    client.onReaction = (event) => {
      const online = this.online();
      // Your own reaction was shown when you sent it.
      if (client === this.onlineClient && online && event.by !== online.side) this.showReaction(event.by, event.reaction);
    };
    client.onConnection = (connection, reconnected) => {
      if (client !== this.onlineClient || !this.online()) return;
      if (connection === 'reconnecting') this.updateOnline({ connection: 'reconnecting' });
      // Back, but not in the seat yet: still "reconnecting" until the server says so.
      else if (reconnected) void this.rejoinAfterDrop(client);
    };
    return client;
  }

  /** Socket.IO reconnects by itself; then the server has to be told which seat this is. */
  private async rejoinAfterDrop(client: OnlineClient): Promise<void> {
    const session = this.onlineSession;
    if (!session) return;
    const reply = await client.rejoin(session.code, session.token);
    if (client !== this.onlineClient) return;
    if (reply.ok) {
      this.updateOnline({ connection: 'connected', error: null });
      const pending = this.pendingAction;
      if (pending && reply.view.seq === pending.seqBefore) {
        // The server never got the move made just before the drop (its queued copy was given
        // up on). This copy of the game is still at that move: send it again.
        this.onlineSeq = pending.seqBefore;
        this.sendAction(pending.action);
        return;
      }
      this.pendingAction = null;
      this.applyRoomView(reply.view, false);
    } else if (!('unreachable' in reply)) {
      // The server is back but doesn't have the game (it restarted, or the room expired).
      this.gameGone(reply.error);
    }
    // Unreachable: still reconnecting. If the connection drops again, Socket.IO says so when
    // it's back; if it stayed up and this request just went unanswered, ask again shortly.
    else setTimeout(() => {
      if (client === this.onlineClient && this.online()?.connection === 'reconnecting') void this.rejoinAfterDrop(client);
    }, REJOIN_RETRY_MS);
  }

  private enterRoom(view: RoomView): void {
    this.abandonComputerMove();
    this.controller.newGame({ mode: 'online' });
    this.startGameTimes();
    this.online.set({
      code: view.code,
      side: view.yourSide,
      opponentJoined: view.opponentJoined,
      opponentConnected: view.opponentConnected,
      connection: 'connected',
      error: null,
      opponentGoneSince: null,
      game: view.game,
      result: null,
      drawOffer: null,
      rematch: { you: false, opponent: false },
      claimWinAt: null,
      moveTimeMs: view.moveTimeMs ?? 0,
    });
    this.applyRoomView(view, true);
  }

  /**
   * Brings this copy of the game in line with the server's. The opponent's latest action is
   * played here like a computer move, so it animates and makes its sound; anything else
   * that doesn't add up (a missed update, a refused move) snaps to the server's position.
   */
  private applyRoomView(view: RoomView, snap: boolean): void {
    const online = this.online();
    if (!online) return;
    // A rematch: the next game, maybe with the other colour. Start it fresh.
    const nextGame = view.game !== online.game;
    if (nextGame) {
      this.controller.newGame({ mode: 'online' });
      this.startGameTimes();
      this.pendingAction = null;
      snap = true;
    }
    // The game has moved on since the last problem: the message is old news.
    const movedOn = nextGame || (!snap && view.seq !== this.onlineSeq);
    const opponentGone = view.opponentJoined && !view.opponentConnected;
    const now = this.now();
    this.online.set({
      ...online,
      side: view.yourSide,
      opponentJoined: view.opponentJoined,
      opponentConnected: view.opponentConnected,
      error: movedOn ? null : online.error,
      opponentGoneSince: opponentGone ? (online.opponentGoneSince ?? now - (view.opponentGoneForMs ?? 0)) : null,
      game: view.game,
      result: view.result,
      drawOffer: view.drawOffer,
      rematch: view.rematch,
      claimWinAt: view.opponentGoneForMs === null ? null : now + Math.max(0, view.claimWinAfterMs - view.opponentGoneForMs),
      moveTimeMs: view.moveTimeMs ?? 0,
    });

    // The opponent's action, or either player's turn skipped by the server's clock.
    const last = view.lastAction;
    const theirsToPlay = !snap && view.seq === this.onlineSeq + 1 && last !== null && (last.by !== online.side || last.kind === 'timeout');
    if (theirsToPlay && last) {
      this.onlineSeq = view.seq;
      this.playRoomAction(last);
    }

    const inStep = !snap && view.seq === this.onlineSeq && sameState(this.controller.state, view.state);
    if (!inStep) {
      this.controller.loadHistory(view.actions ?? [], fromWire(view.state));
      this.onlineSeq = view.seq;
      this.stopMoving();
      this.queuedTaps = [];
      this.updateKindValue = 'reset';
    }
    // The server keeps the time online: its clock, from what's left on it as it sent this.
    this.setClock(
      view.turnLeftMs === null || view.turnLeftMs === undefined || !view.moveTimeMs
        ? null
        : { side: view.state.toMove, deadline: now + view.turnLeftMs, totalMs: view.moveTimeMs },
    );
    this.bump();
  }

  private playRoomAction(action: RoomAction): void {
    if (action.kind === 'timeout') {
      this.skipTurn();
      return;
    }
    if (action.kind === 'nfikh') {
      this.controller.takeForfeit(action.square);
      this.showNfikh();
      return;
    }
    const move = this.controller.legalMoves.find((m) => samePath(m.path, action.path));
    if (!move) return; // applyRoomView sees the mismatch and snaps to the server's position
    this.controller.applyExternalMove(move);
    this.startMove();
  }

  /** Tells the server about the player's own action, already shown on the board. */
  private sendOnline(result: 'move' | 'nfikh'): void {
    const action: OnlineAction =
      result === 'nfikh'
        ? { kind: 'nfikh', square: this.controller.lastNfikh!.square }
        : { kind: 'move', path: this.controller.lastMove!.path };
    this.sendAction(action);
    // The opponent's clock starts now; the server's update brings its exact time shortly.
    const online = this.online();
    if (result === 'move' && online && online.moveTimeMs > 0) {
      this.setClock({ side: this.controller.state.toMove, deadline: this.now() + online.moveTimeMs, totalMs: online.moveTimeMs });
    }
  }

  private sendAction(action: OnlineAction): void {
    const client = this.onlineClient;
    const session = this.onlineSession;
    if (!client || !session) return;
    const pending = { action, seqBefore: this.onlineSeq };
    this.pendingAction = pending;
    this.onlineSeq++;
    void client.act(session.code, session.token, action).then((reply) => {
      if (client !== this.onlineClient) return;
      // No answer in time: the connection dropped. The action may still get there once it's
      // back, or be sent again on rejoin (see rejoinAfterDrop), so this isn't a refusal.
      if (!reply.ok && 'unreachable' in reply) return;
      if (this.pendingAction === pending) this.pendingAction = null;
      if (reply.ok) {
        this.updateOnline({ error: null });
        return;
      }
      if (reply.view) {
        this.updateOnline({ error: reply.error });
        this.applyRoomView(reply.view, true);
      } else {
        // Refused without a position: the server doesn't have this game any more.
        this.gameGone(reply.error);
      }
    });
  }

  /** Online, game on: ends it, and the opponent wins. */
  resign(): void {
    this.sendRequest((client, seat) => client.resign(seat.code, seat.token));
  }

  /** Online, game on: offers the opponent a draw. */
  offerDraw(): void {
    this.sendRequest((client, seat) => client.offerDraw(seat.code, seat.token));
  }

  /** Online: accepts or declines the opponent's draw offer. */
  answerDraw(accept: boolean): void {
    this.sendRequest((client, seat) => client.answerDraw(seat.code, seat.token, accept));
  }

  /** Online: wins, once the opponent has been gone long enough (the server checks). */
  claimWin(): void {
    this.sendRequest((client, seat) => client.claimWin(seat.code, seat.token));
  }

  /** Online, after a game: asks for a rematch (`yes`), or turns one down / takes it back. */
  askRematch(yes: boolean): void {
    this.sendRequest((client, seat) => client.rematch(seat.code, seat.token, yes));
  }

  /**
   * Sends one of the requests above. The server's answer comes as a room update to both
   * players, so only a refusal needs handling here.
   */
  private sendRequest(send: (client: OnlineClient, seat: Seat) => Promise<ActionReply | { ok: false; error: string; unreachable: true }>): void {
    const client = this.onlineClient;
    const seat = this.onlineSession;
    if (!client || !seat) return;
    void send(client, seat).then((reply) => {
      if (client !== this.onlineClient) return;
      this.updateOnline({ error: reply.ok ? null : reply.error });
    });
  }

  private updateOnline(change: Partial<OnlineStatus>): void {
    const online = this.online();
    if (online) this.online.set({ ...online, ...change });
  }

  /** Settings as "you" see them: online, `playerSide` is the side the server gave you. */
  private perspective(): Settings {
    const settings = this.settings();
    return { ...settings, playerSide: this.playerSide() };
  }

  private async maybeTriggerComputer(): Promise<void> {
    const settings = this.controller.settings;
    if (settings.mode !== 'computer') return;
    if (this.controller.outcome.kind !== 'ongoing') return;
    if (this.controller.state.toMove === settings.playerSide) return;
    if (this.thinking() || this.moving()) return;

    const request = ++this.aiRequest;
    this.thinking.set(true);
    const reply = await this.ai.chooseTurn({
      board: this.controller.state.board,
      side: this.controller.state.toMove,
      forfeitable: this.controller.state.forfeitable,
      options: { difficulty: settings.difficulty, strictMode: settings.strictMode },
    });
    // New game, undo or a strict-mode change while it was thinking: this reply belongs to a
    // position that's gone, and the new one has already been dealt with.
    if (request !== this.aiRequest) return;

    // Taking a piece by nfikh comes first, with a beat so the player sees what happened.
    if (reply && reply.nfikh !== null && this.controller.state.forfeitable.includes(reply.nfikh)) {
      this.controller.takeForfeit(reply.nfikh);
      this.showNfikh();
      this.bump();
      await delay(NFIKH_PAUSE_MS);
      if (request !== this.aiRequest) return;
    }
    this.thinking.set(false);

    // Only ever play a move that's legal in the current position.
    const move = reply && this.controller.legalMoves.find((m) => sameMove(m, reply.move));
    if (move) {
      this.controller.applyExternalMove(move);
      this.startMove();
      this.bump();
    }
  }

  /**
   * Forgets the computer's reply still being worked out, if any (it will be ignored), and any
   * taps still waiting for a move to land: the position they were meant for is gone.
   */
  private abandonComputerMove(): void {
    this.aiRequest++;
    this.thinking.set(false);
    this.queuedTaps = [];
  }

  private showNfikh(): void {
    this.updateKindValue = 'nfikh';
    this.audio.capture(1);
  }

  // ---- The move timer ------------------------------------------------------------------

  /**
   * Offline: starts the clock for the turn about to be played, if there's one to run: a move
   * timer is set, the game is on, nothing is still moving, and it's a person's turn (the
   * computer has no clock). Online the server keeps the time (see applyRoomView).
   */
  private restartClock(): void {
    if (this.online()) return;
    const settings = this.controller.settings;
    const totalMs = settings.moveTime * 1000;
    const side = this.controller.state.toMove;
    const personToMove = settings.mode === 'pvp' || side === settings.playerSide;
    const run = totalMs > 0 && personToMove && !this.moving() && this.controller.outcome.kind === 'ongoing';
    this.setClock(run ? { side, deadline: this.now() + totalMs, totalMs } : null);
  }

  private setClock(clock: TurnClock | null): void {
    this.turnClock.set(clock);
    this.tickedSecond = null;
    if (clock === null) {
      if (this.clockTicker !== null) clearInterval(this.clockTicker);
      this.clockTicker = null;
      this.turnLeftMs.set(null);
      return;
    }
    this.clockTick();
    if (this.clockTicker === null) this.clockTicker = setInterval(() => this.clockTick(), CLOCK_TICK_MS);
  }

  /**
   * Counts down: the time left for the screen, a soft tick each second of the player's own
   * last 10 seconds, and, offline, the turn skipped when the time is up. (Online the server
   * skips it and says so.)
   */
  private clockTick(): void {
    const clock = this.turnClock();
    if (!clock) return;
    const left = Math.max(0, clock.deadline - this.now());
    this.turnLeftMs.set(left);
    const second = Math.ceil(left / 1000);
    if (left > 0 && left <= LOW_TIME_MS && second !== this.tickedSecond && this.isOwnClock(clock.side)) {
      this.tickedSecond = second;
      this.audio.clockTick();
    }
    if (left === 0 && !this.online()) this.timeUp();
  }

  /** Whether the clock running is the player's own, the one to hurry them (both sides in 1v1). */
  private isOwnClock(side: Side): boolean {
    return this.controller.settings.mode === 'pvp' || side === this.playerSide();
  }

  /** Offline: the time for the turn ran out. */
  private timeUp(): void {
    if (this.moving() || this.controller.outcome.kind !== 'ongoing') {
      this.setClock(null);
      return;
    }
    this.skipTurn();
    this.bump();
    this.restartClock();
    void this.maybeTriggerComputer();
  }

  /** The side to move ran out of time: its turn is skipped. */
  private skipTurn(): void {
    const side = this.controller.state.toMove;
    this.controller.passTurn();
    this.queuedTaps = [];
    this.updateKindValue = 'reset';
    this.audio.nope();
    this.announcement.set(`${this.whoIs(side)} ran out of time: the turn is skipped.`);
  }

  /** "You", "Opponent", "Computer", or the side's colour in 1v1. */
  private whoIs(side: Side): string {
    return playerName(side, this.perspective());
  }

  private startMove(): void {
    this.updateKindValue = 'move';
    this.moving.set(true);
    // Offline, the next turn's clock starts once this move has landed.
    if (!this.online()) this.setClock(null);
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
   * opponent's (vs the computer or online; there's no "ours" in 1v1, so it stays neutral there).
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
      const moveWasOpponents = settings.mode !== 'pvp' && moverSide !== settings.playerSide;
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
 * 2 pieces captured, promoted to king." Vs the computer it says "You"/"Computer", online
 * "You"/"Opponent"; in 1v1 it names the side.
 */
export function describeMove(move: Move, settings: Settings): string {
  const who = playerName(Math.sign(move.piece) as Side, settings);
  const route = move.path.map(squareName).join(move.captures.length > 0 ? ' takes ' : ' to ');
  const details: string[] = [];
  if (move.captures.length > 1) details.push(`${move.captures.length} pieces captured`);
  if (move.capturedKing) details.push('a king captured');
  if (move.promotes) details.push('promoted to king');
  return `${who} played ${[route, ...details].join(', ')}.`;
}

/** Who plays `side`: "You" and "Computer" or "Opponent", or in 1v1 the side's colour. */
export function playerName(side: Side, settings: Settings): string {
  if (settings.mode === 'pvp') return side === LIGHT ? 'White' : 'Black';
  if (side === settings.playerSide) return 'You';
  return settings.mode === 'online' ? 'Opponent' : 'Computer';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fromWire(state: WireState): GameState {
  return { ...state, board: Int8Array.from(state.board), timeouts: state.timeouts ?? { light: 0, dark: 0 } };
}

function sameState(local: GameState, remote: WireState): boolean {
  return (
    local.toMove === remote.toMove &&
    local.board.length === remote.board.length &&
    local.board.every((cell, i) => cell === remote.board[i]) &&
    local.forfeitable.length === remote.forfeitable.length &&
    local.forfeitable.every((square) => remote.forfeitable.includes(square)) &&
    // An older server sends no time-outs.
    (remote.timeouts === undefined || (local.timeouts.light === remote.timeouts.light && local.timeouts.dark === remote.timeouts.dark))
  );
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((square, i) => square === b[i]);
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
