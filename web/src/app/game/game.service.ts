import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AiClient } from '../ai/ai-client';
import { AudioService } from '../audio/audio.service';
import { checkOnlineServer, OnlineClient, onlineServerUrl } from '../online/online-client';
import { isKing, squareName } from '../../engine/board';
import { DARK, GameState, LIGHT, Move, Side } from '../../engine/types';
import { OnlineAction, RoomView, WireState } from '../../protocol/online';
import { defaultSettings, GameController, Settings, UpdateKind } from './game-controller';

const STORAGE_KEY = 'dama.settings.v1';
/** Backstop in case the board never reports a move as settled: no animation is this long. */
const SETTLE_TIMEOUT_MS = 5000;
/** When the computer takes a piece by nfikh, how long it pauses before making its move. */
const NFIKH_PAUSE_MS = 600;
/** This tab's seat in an online room, kept per tab: two tabs on one computer are two players. */
const ONLINE_SESSION_KEY = 'dama.online.v1';
/** After a reconnect, how long to wait before asking for the seat again if the server didn't answer. */
const REJOIN_RETRY_MS = 2000;

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
}

/** Whether the online server answered the last check. 'checking' only until the first answer. */
export type OnlineServerState = 'checking' | 'up' | 'down';

/** How to get into an online room, from the home screen. */
export type OnlineEntry = { kind: 'create' } | { kind: 'join'; code: string };

interface OnlineSession {
  code: string;
  token: string;
}

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

function loadSession(): OnlineSession | null {
  try {
    const raw = sessionStorage.getItem(ONLINE_SESSION_KEY);
    return raw ? (JSON.parse(raw) as OnlineSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: OnlineSession | null): void {
  try {
    if (session) sessionStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(ONLINE_SESSION_KEY);
  } catch {
    // No storage: a reload just won't find its way back into the room.
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
  /** What just happened (a move, Undo, New game) in words, for screen readers to announce. */
  readonly announcement = signal('');
  /** A move is still playing out on the board: nobody can move until it has landed. */
  readonly moving = signal(false);
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped for every question put to the computer, and to abandon the one in flight. */
  private aiRequest = 0;

  /** Made when an online game starts; replaceable in tests. */
  private onlineClientFactory = () => new OnlineClient(onlineServerUrl());
  private onlineClient: OnlineClient | null = null;
  /** This tab's seat, also kept in sessionStorage for reloads. Every action is sent with it. */
  private onlineSession: OnlineSession | null = null;
  /** How many of the room's actions this copy of the game has played (RoomView.seq). */
  private onlineSeq = 0;
  /**
   * The player's own action the server hasn't confirmed yet, and the room's `seq` before it.
   * If the connection drops, the server may never get it: then it's sent again on rejoin.
   */
  private pendingAction: { action: OnlineAction; seqBefore: number } | null = null;
  readonly online = signal<OnlineStatus | null>(null);
  readonly onlineServer = signal<OnlineServerState>('checking');
  /** Replaceable in tests. */
  private onlineServerProbe = (url: string) => checkOnlineServer(url);
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
  readonly outcome = computed(() => {
    this.version();
    return this.controller.outcome;
  });
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
      if (justEnded && outcome.kind === 'win') {
        const playerLost = settings.mode !== 'pvp' && outcome.winner !== settings.playerSide;
        if (playerLost) this.audio.loss();
        else this.audio.win();
      }
    });
    // No game starts on its own: the home screen starts one with newGame().
  }

  tapSquare(square: number): void {
    if (this.thinking() || this.moving() || !this.isHumanTurn()) return;
    const result = this.controller.tapSquare(square);
    if (result === 'move') this.startMove();
    if (result === 'nfikh') this.showNfikh();
    this.bump();
    if (result !== 'none' && this.online()) this.sendOnline(result);
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

  /** A new offline game (vs the computer or 1v1). Leaves the online room, if in one. */
  newGame(partial?: Partial<Settings>): void {
    this.leaveOnline();
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
      return !!online && online.opponentJoined && online.connection === 'connected' && this.controller.state.toMove === online.side;
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
    const reply =
      entry.kind === 'create' ? await client.create(settings.playerSide, settings.strictMode) : await client.join(entry.code);
    if (client !== this.onlineClient) return 'Cancelled.'; // left again before the server answered
    if (!reply.ok) {
      this.leaveOnline();
      return reply.error;
    }
    this.setSession({ code: reply.view.code, token: reply.token });
    this.enterRoom(reply.view);
    return null;
  }

  /** Back into this tab's online room after a page reload, if it had one. Resolves true if so. */
  async resumeOnline(): Promise<boolean> {
    const session = loadSession();
    if (!session) return false;
    const client = this.connectOnline();
    const reply = await client.rejoin(session.code, session.token);
    if (client !== this.onlineClient) return false;
    if (!reply.ok) {
      this.leaveOnline();
      return false;
    }
    this.setSession(session);
    this.enterRoom(reply.view);
    return true;
  }

  /**
   * Asks whether the online server is there, for the home screen's Online button. Until the
   * answer comes back, the previous one stands (so the button doesn't flicker on a re-check).
   */
  async checkOnlineServer(): Promise<void> {
    const check = ++this.onlineServerChecks;
    const up = await this.onlineServerProbe(onlineServerUrl());
    if (check === this.onlineServerChecks) this.onlineServer.set(up ? 'up' : 'down');
  }

  /** Leaves the online room, if in one. The friend sees this player as disconnected. */
  leaveOnline(): void {
    this.pendingAction = null;
    this.onlineClient?.close();
    this.onlineClient = null;
    this.online.set(null);
    this.setSession(null);
  }

  private setSession(session: OnlineSession | null): void {
    this.onlineSession = session;
    saveSession(session);
  }

  private connectOnline(): OnlineClient {
    const client = this.onlineClientFactory();
    this.onlineClient = client;
    client.onUpdate = (view) => {
      if (client === this.onlineClient && this.online()) this.applyRoomView(view, false);
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
      this.updateOnline({ connection: 'lost', error: reply.error });
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
    this.online.set({
      code: view.code,
      side: view.yourSide,
      opponentJoined: view.opponentJoined,
      opponentConnected: view.opponentConnected,
      connection: 'connected',
      error: null,
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
    // The game has moved on since the last problem: the message is old news.
    const movedOn = !snap && view.seq !== this.onlineSeq;
    this.online.set({
      ...online,
      opponentJoined: view.opponentJoined,
      opponentConnected: view.opponentConnected,
      error: movedOn ? null : online.error,
    });

    const opponentsNext =
      !snap && view.seq === this.onlineSeq + 1 && view.lastAction !== null && view.lastAction.by !== online.side;
    if (opponentsNext && view.lastAction) {
      this.onlineSeq = view.seq;
      this.playOpponentAction(view.lastAction);
    }

    const inStep = !snap && view.seq === this.onlineSeq && sameState(this.controller.state, view.state);
    if (!inStep) {
      this.controller.loadPosition(fromWire(view.state));
      this.onlineSeq = view.seq;
      this.stopMoving();
      this.updateKindValue = 'reset';
    }
    this.bump();
  }

  private playOpponentAction(action: OnlineAction): void {
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
        this.updateOnline({ connection: 'lost', error: reply.error });
      }
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

  /** Forgets the computer's reply still being worked out, if any: it will be ignored. */
  private abandonComputerMove(): void {
    this.aiRequest++;
    this.thinking.set(false);
  }

  private showNfikh(): void {
    this.updateKindValue = 'nfikh';
    this.audio.capture(1);
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
  const side = Math.sign(move.piece);
  const who =
    settings.mode !== 'pvp'
      ? side === settings.playerSide
        ? 'You'
        : settings.mode === 'online'
          ? 'Opponent'
          : 'Computer'
      : side === LIGHT
        ? 'White'
        : 'Black';
  const route = move.path.map(squareName).join(move.captures.length > 0 ? ' takes ' : ' to ');
  const details: string[] = [];
  if (move.captures.length > 1) details.push(`${move.captures.length} pieces captured`);
  if (move.capturedKing) details.push('a king captured');
  if (move.promotes) details.push('promoted to king');
  return `${who} played ${[route, ...details].join(', ')}.`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fromWire(state: WireState): GameState {
  return { ...state, board: Int8Array.from(state.board) };
}

function sameState(local: GameState, remote: WireState): boolean {
  return (
    local.toMove === remote.toMove &&
    local.board.length === remote.board.length &&
    local.board.every((cell, i) => cell === remote.board[i]) &&
    local.forfeitable.length === remote.forfeitable.length &&
    local.forfeitable.every((square) => remote.forfeitable.includes(square))
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
