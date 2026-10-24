import { advanceState, createInitialState, legalMoves, outcome, takeForfeit } from '../../web/src/engine/game';
import { DARK, GameState, LIGHT, Side } from '../../web/src/engine/types';
import { OnlineAction, RoomView, WireState } from '../../web/src/protocol/online';

/** No 0/O or 1/I/L: a code is read off one screen and typed on another. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

interface Seat {
  token: string;
  connected: boolean;
}

export interface Room {
  code: string;
  state: GameState;
  seats: Partial<Record<'light' | 'dark', Seat>>;
  seq: number;
  lastAction: (OnlineAction & { by: Side }) | null;
  /** When the last player disconnected, or null while anyone is connected. */
  emptySince: number | null;
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
    };
    const token = this.newToken();
    room.seats[seatKey(side)] = { token, connected: true };
    this.rooms.set(room.code, room);
    return { room, token };
  }

  /** Takes the free seat in a room. */
  join(code: string): Result<{ room: Room; side: Side; token: string }> {
    const room = this.rooms.get(normalizeCode(code));
    if (!room) return { ok: false, error: 'No room with that code.' };
    const side = !room.seats.light ? LIGHT : !room.seats.dark ? DARK : null;
    if (side === null) return { ok: false, error: 'That room is full.' };
    const token = this.newToken();
    room.seats[seatKey(side)] = { token, connected: true };
    room.emptySince = null;
    return { ok: true, value: { room, side, token } };
  }

  /** A player coming back (reload, dropped connection) with the token they were given. */
  rejoin(code: string, token: string): Result<{ room: Room; side: Side }> {
    const room = this.rooms.get(normalizeCode(code));
    const side = room && this.sideOf(room, token);
    if (!room || !side) return { ok: false, error: 'That game is no longer available.' };
    room.seats[seatKey(side)]!.connected = true;
    room.emptySince = null;
    return { ok: true, value: { room, side } };
  }

  setConnected(room: Room, side: Side, connected: boolean): void {
    const seat = room.seats[seatKey(side)];
    if (seat) seat.connected = connected;
    const anyoneThere = Object.values(room.seats).some((s) => s?.connected);
    room.emptySince = anyoneThere ? null : this.now();
  }

  /**
   * Checks an action with the engine and, if it's legal, plays it. `action` comes straight off
   * the network, so its shape is checked too.
   */
  play(room: Room, side: Side, action: unknown): Result<void> {
    if (!isAction(action)) return { ok: false, error: 'Not a valid action.' };
    if (!room.seats.light || !room.seats.dark) return { ok: false, error: 'Waiting for the other player.' };
    if (outcome(room.state).kind !== 'ongoing') return { ok: false, error: 'The game is over.' };
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
    return { ok: true, value: undefined };
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
    };
  }

  private sideOf(room: Room, token: string): Side | null {
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
