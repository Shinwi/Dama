import { advanceState, createInitialState, legalMoves, outcome, takeForfeit } from '../../web/src/engine/game';
import { DARK, GameState, LIGHT, Side } from '../../web/src/engine/types';
import { OnlineAction, RoomResult, RoomView, WireState } from '../../web/src/protocol/online';

/** No 0/O or 1/I/L: a code is read off one screen and typed on another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
/**
 * A third player, or a player who lost their seat's token (e.g. on another device). The
 * seat stays reserved for whoever holds the token, so it can't simply be taken over.
 */
export const ROOM_FULL = 'That room already has two players. If one of them is you, open the game on the device you started it on.';

interface Seat {
  token: string;
  connected: boolean;
  /** When this player lost their connection, while they're gone; null while connected. */
  disconnectedAt: number | null;
}

/** How long an opponent must be gone before the other player can claim the win. */
export const DEFAULT_CLAIM_WIN_AFTER_MS = 5 * 60 * 1000;

export interface Room {
  code: string;
  state: GameState;
  seats: Partial<Record<'light' | 'dark', Seat>>;
  seq: number;
  lastAction: (OnlineAction & { by: Side }) | null;
  /** When the last player disconnected, or null while anyone is connected. */
  emptySince: number | null;
  /** When the second player joined (the game started), or null while waiting for them. */
  startedAt: number | null;
  /** When the game ended (a win or a draw), or null while it's on. */
  finishedAt: number | null;
  /** How the game ended, if not on the board: resigned, an agreed draw, a claimed win. */
  result: RoomResult | null;
  /** The side with an open draw offer, waiting for the other's answer. */
  drawOffer: Side | null;
  /** After the game: who has asked for a rematch. Both → the next game starts. */
  rematch: { light: boolean; dark: boolean };
  /** Counts games in this room (0 for the first): a rematch starts the next one. */
  game: number;
}

/** A game that has just ended, for the metrics. */
export interface FinishedGame {
  result: 'win' | 'draw' | RoomResult['kind'];
  durationMs: number;
  /** Accepted actions: moves and nfikh. */
  actions: number;
}

/** How many rooms and players there are right now. */
export interface RoomCounts {
  /** All rooms in memory. */
  open: number;
  /** One player in, waiting for the friend to join. */
  waiting: number;
  /** Both players have joined, the game isn't over, and at least one of them is connected. */
  active: number;
  /** Seats whose player is connected right now. */
  playersConnected: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const seatKey = (side: Side) => (side === LIGHT ? 'light' : 'dark');
const other = (side: Side) => (side === LIGHT ? DARK : LIGHT) as Side;

/**
 * Every open room, in memory: a server restart forgets them all, which is fine for now.
 * Pure game-room logic with no networking, so it's tested on its own; `server.ts` wires it
 * to Socket.IO.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
    private readonly claimWinAfterMs = DEFAULT_CLAIM_WIN_AFTER_MS,
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  create(side: Side, strictMode: boolean): { room: Room; token: string } {
    const room: Room = {
      code: this.freshCode(),
      state: createInitialState(strictMode),
      seats: {},
      seq: 0,
      lastAction: null,
      emptySince: null,
      startedAt: null,
      finishedAt: null,
      result: null,
      drawOffer: null,
      rematch: { light: false, dark: false },
      game: 0,
    };
    const token = this.newToken();
    room.seats[seatKey(side)] = { token, connected: true, disconnectedAt: null };
    this.rooms.set(room.code, room);
    return { room, token };
  }

  /** Takes the free seat in a room. */
  join(code: string): Result<{ room: Room; side: Side; token: string }> {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) return { ok: false, error: 'No room with that code.' };
    const side = !room.seats.light ? LIGHT : !room.seats.dark ? DARK : null;
    if (side === null) return { ok: false, error: ROOM_FULL };
    const token = this.newToken();
    room.seats[seatKey(side)] = { token, connected: true, disconnectedAt: null };
    room.emptySince = null;
    room.startedAt = this.now(); // both seats are taken now
    return { ok: true, value: { room, side, token } };
  }

  /** A player coming back (reload, dropped connection) with the token they were given. */
  rejoin(code: string, token: string): Result<{ room: Room; side: Side }> {
    const room = this.rooms.get(normalizeCode(code));
    const side = room && this.sideOf(room, token);
    if (!room || !side) return { ok: false, error: 'That game is no longer available.' };
    this.setConnected(room, side, true);
    return { ok: true, value: { room, side } };
  }

  setConnected(room: Room, side: Side, connected: boolean): void {
    const seat = room.seats[seatKey(side)];
    if (seat && seat.connected !== connected) {
      seat.connected = connected;
      seat.disconnectedAt = connected ? null : this.now();
    }
    const anyoneThere = Object.values(room.seats).some((s) => s?.connected);
    room.emptySince = anyoneThere ? null : this.now();
  }

  /**
   * Checks an action with the engine and, if it's legal, plays it. `action` comes straight off
   * the network, so its shape is checked too. Says whether this action ended the game.
   */
  play(room: Room, side: Side, action: unknown): Result<{ finished: FinishedGame | null }> {
    if (!isAction(action)) return { ok: false, error: 'Not a valid action.' };
    const notOn = this.gameNotOn(room);
    if (notOn) return { ok: false, error: notOn };
    if (room.state.toMove !== side) return { ok: false, error: 'Not your turn.' };

    if (action.kind === 'nfikh') {
      if (!room.state.forfeitable.includes(action.square)) return { ok: false, error: 'That piece cannot be taken.' };
      room.state = takeForfeit(room.state, action.square);
    } else {
      const move = legalMoves(room.state).find((m) => samePath(m.path, action.path));
      if (!move) return { ok: false, error: 'Illegal move.' };
      room.state = advanceState(room.state, move);
    }
    room.seq++;
    // Rebuilt rather than spread, so nothing else the client sent along is kept.
    room.lastAction =
      action.kind === 'nfikh' ? { kind: 'nfikh', square: action.square, by: side } : { kind: 'move', path: [...action.path], by: side };
    // A draw offer stands until the player it was made to plays a move instead of answering.
    if (room.drawOffer !== null && room.drawOffer !== side) room.drawOffer = null;
    const result = outcome(room.state);
    if (result.kind === 'ongoing' || room.finishedAt !== null) return { ok: true, value: { finished: null } };
    return { ok: true, value: { finished: this.finish(room, result.kind) } };
  }

  /** Ends the game: `side` resigns, and the opponent wins. */
  resign(room: Room, side: Side): Result<FinishedGame> {
    const notOn = this.gameNotOn(room);
    if (notOn) return { ok: false, error: notOn };
    room.result = { kind: 'resigned', winner: other(side) };
    return { ok: true, value: this.finish(room, 'resigned') };
  }

  /**
   * `side` offers a draw. If the opponent had already offered one, this accepts it: says
   * whether the game ended.
   */
  offerDraw(room: Room, side: Side): Result<{ finished: FinishedGame | null }> {
    const notOn = this.gameNotOn(room);
    if (notOn) return { ok: false, error: notOn };
    if (room.drawOffer === side) return { ok: false, error: 'You have already offered a draw.' };
    if (room.drawOffer === other(side)) return this.answerDraw(room, side, true);
    room.drawOffer = side;
    return { ok: true, value: { finished: null } };
  }

  /** `side` accepts or declines the opponent's draw offer. Says whether the game ended. */
  answerDraw(room: Room, side: Side, accept: boolean): Result<{ finished: FinishedGame | null }> {
    const notOn = this.gameNotOn(room);
    if (notOn) return { ok: false, error: notOn };
    if (room.drawOffer !== other(side)) return { ok: false, error: 'There is no draw offer to answer.' };
    room.drawOffer = null;
    if (!accept) return { ok: true, value: { finished: null } };
    room.result = { kind: 'draw_agreed', winner: null };
    return { ok: true, value: { finished: this.finish(room, 'draw_agreed') } };
  }

  /** `side` wins because the opponent has been gone for `claimWinAfterMs`. */
  claimWin(room: Room, side: Side): Result<FinishedGame> {
    const notOn = this.gameNotOn(room);
    if (notOn) return { ok: false, error: notOn };
    const gone = this.goneFor(room, other(side));
    if (gone === null) return { ok: false, error: 'Your opponent is here.' };
    if (gone < this.claimWinAfterMs) return { ok: false, error: 'Your opponent may still come back.' };
    room.result = { kind: 'abandoned', winner: side };
    return { ok: true, value: this.finish(room, 'abandoned') };
  }

  /**
   * After a game: `side` asks for a rematch (`yes`), or turns one down / takes its request
   * back (which clears both requests). When both have asked, the next game starts: same rules,
   * colours swapped. Says whether it started.
   */
  rematch(room: Room, side: Side, yes: boolean): Result<{ started: boolean }> {
    if (!this.isOver(room)) return { ok: false, error: 'The game is still on.' };
    if (!yes) {
      room.rematch = { light: false, dark: false };
      return { ok: true, value: { started: false } };
    }
    room.rematch[seatKey(side)] = true;
    if (!room.rematch.light || !room.rematch.dark) return { ok: true, value: { started: false } };

    room.seats = { light: room.seats.dark, dark: room.seats.light };
    room.state = createInitialState(room.state.strictMode);
    room.seq = 0;
    room.lastAction = null;
    room.result = null;
    room.drawOffer = null;
    room.rematch = { light: false, dark: false };
    room.game++;
    room.startedAt = this.now();
    room.finishedAt = null;
    return { ok: true, value: { started: true } };
  }

  /** Over: on the board (a win or draw), or by a result (resigned, agreed draw, claimed win). */
  isOver(room: Room): boolean {
    return room.result !== null || outcome(room.state).kind !== 'ongoing';
  }

  /** Why nothing can be played right now, or null if the game is on. */
  private gameNotOn(room: Room): string | null {
    if (!room.seats.light || !room.seats.dark) return 'Waiting for the other player.';
    if (this.isOver(room)) return 'The game is over.';
    return null;
  }

  private finish(room: Room, result: FinishedGame['result']): FinishedGame {
    room.finishedAt = this.now();
    room.drawOffer = null;
    return { result, durationMs: room.finishedAt - (room.startedAt ?? room.finishedAt), actions: room.seq };
  }

  /** How long `side`'s player has been disconnected, or null if they're connected (or absent). */
  private goneFor(room: Room, side: Side): number | null {
    const seat = room.seats[seatKey(side)];
    return seat && !seat.connected && seat.disconnectedAt !== null ? this.now() - seat.disconnectedAt : null;
  }

  counts(): RoomCounts {
    const counts: RoomCounts = { open: this.rooms.size, waiting: 0, active: 0, playersConnected: 0 };
    for (const room of this.rooms.values()) {
      const seats = [room.seats.light, room.seats.dark].filter((seat) => seat !== undefined);
      const connected = seats.filter((seat) => seat.connected).length;
      counts.playersConnected += connected;
      if (seats.length < 2) counts.waiting++;
      else if (room.finishedAt === null && connected > 0) counts.active++;
    }
    return counts;
  }

  /** Forgets rooms nobody has been connected to for `maxIdleMs`. Returns how many went. */
  sweep(maxIdleMs: number): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && this.now() - room.emptySince >= maxIdleMs) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  view(room: Room, side: Side): RoomView {
    const opponent = room.seats[seatKey(other(side))];
    return {
      code: room.code,
      yourSide: side,
      opponentJoined: !!opponent,
      opponentConnected: !!opponent?.connected,
      state: toWire(room.state),
      seq: room.seq,
      lastAction: room.lastAction,
      game: room.game,
      result: room.result,
      drawOffer: room.drawOffer === null ? null : room.drawOffer === side ? 'you' : 'opponent',
      rematch: { you: room.rematch[seatKey(side)], opponent: room.rematch[seatKey(other(side))] },
      opponentGoneForMs: this.goneFor(room, other(side)),
      claimWinAfterMs: this.claimWinAfterMs,
    };
  }

  /** The side whose seat `token` is, if any. (A rematch swaps the sides, not the tokens.) */
  sideOf(room: Room, token: string): Side | null {
    if (room.seats.light?.token === token) return LIGHT;
    if (room.seats.dark?.token === token) return DARK;
    return null;
  }

  private freshCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private newToken(): string {
    return crypto.randomUUID();
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function toWire(state: GameState): WireState {
  return { ...state, board: Array.from(state.board) };
}

function isAction(value: unknown): value is OnlineAction {
  if (typeof value !== 'object' || value === null) return false;
  const action = value as Record<string, unknown>;
  if (action['kind'] === 'nfikh') return Number.isInteger(action['square']);
  if (action['kind'] === 'move') return Array.isArray(action['path']) && action['path'].every(Number.isInteger);
  return false;
}

function samePath(a: number[], b: unknown): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((square, i) => square === b[i]);
}
