/**
 * The messages between the web app and the online server (`server/`), over Socket.IO.
 * Plain types only, so both sides can import this file: the server imports it straight from
 * here, like it imports the engine. (Phase 3 moves both into a `shared/` package.)
 *
 * The server is the referee: it keeps each room's GameState and checks every action with
 * the engine before passing it on. Squares are board indexes (row * 10 + col), as in the
 * engine.
 */
import { Side } from '../engine/types';

/** One thing a player does on their turn: take a piece by nfikh, or play a move. */
export type OnlineAction =
  | { kind: 'nfikh'; square: number }
  /** The move's `path`: every square it visits. That's enough to tell any two moves apart. */
  | { kind: 'move'; path: number[] };

/** A GameState as JSON: Socket.IO would send an Int8Array as binary, so it's a plain array. */
export interface WireState {
  board: number[];
  toMove: Side;
  strictMode: boolean;
  quietMoves: number;
  forfeitable: number[];
  timeouts: { light: number; dark: number };
}

/**
 * Something that happened on a turn, and whose turn it was: a player's action, or the server
 * skipping the turn because the move timer ran out.
 */
export type RoomAction = (OnlineAction | { kind: 'timeout' }) & { by: Side };

/**
 * How a game ended other than on the board. (A win or draw on the board isn't here: both
 * sides can see it in `state`.)
 */
export interface RoomResult {
  kind: 'resigned' | 'draw_agreed' | 'abandoned';
  /** The side that won: the resigner's opponent, or the player who claimed the win. Null for a draw. */
  winner: Side | null;
}

/** What one player sees of a room. Sent after every change, to each player separately. */
export interface RoomView {
  code: string;
  /** The side this player plays. */
  yourSide: Side;
  /** Both seats are taken: the game is on. */
  opponentJoined: boolean;
  /** The opponent is connected right now (they may have dropped and be coming back). */
  opponentConnected: boolean;
  state: WireState;
  /** Counts accepted actions, so a client can tell whether it has missed one. */
  seq: number;
  /** The action that made this the position, and who played it. Null at the start. */
  lastAction: RoomAction | null;
  /** Every action of this game so far, in order (so a client can rebuild the move list). */
  actions: RoomAction[];
  /** The move timer: how long each turn may take, or 0 for no timer. */
  moveTimeMs: number;
  /**
   * Time left on the turn being played, as the server sent this; null while no clock runs
   * (no timer, waiting for the friend, game over). The server allows a little extra for the
   * network before it skips the turn.
   */
  turnLeftMs: number | null;
  /** Counts games in this room: a rematch starts the next one (with `seq` back at 0). */
  game: number;
  /** Set when the game ended by resigning, an agreed draw, or a claimed win. */
  result: RoomResult | null;
  /** An open draw offer: made by you, or by your opponent (yours to answer). */
  drawOffer: 'you' | 'opponent' | null;
  /** Who has asked for a rematch since the game ended. */
  rematch: { you: boolean; opponent: boolean };
  /** How long the opponent has been disconnected, as the server sent this; null if they're here. */
  opponentGoneForMs: number | null;
  /** How long the opponent must be gone before you can claim the win. */
  claimWinAfterMs: number;
}

/**
 * A browser's anonymous player ID: random, made on the device, nothing personal. The server
 * only uses it to count different players per day (`/stats`, metrics); it's never shown.
 */
interface WithPlayerId {
  playerId?: string;
}

export interface CreateRoomRequest extends WithPlayerId {
  /** The side the room's creator plays; the friend who joins gets the other one. */
  side: Side;
  strictMode: boolean;
  /** The move timer, in seconds; 0 (or absent) for none. */
  moveTimeSeconds?: number;
}

export interface JoinRoomRequest extends WithPlayerId {
  code: string;
}

export interface RejoinRoomRequest extends WithPlayerId {
  code: string;
  /** The secret handed out on create/join: proves it's the same player coming back. */
  token: string;
}

/** Which seat a request is for (see ActionRequest for why every request says so). */
export interface SeatRequest {
  code: string;
  token: string;
}

export interface ActionRequest {
  /**
   * The seat this action is for, as for room:rejoin. Every action carries it, so the server
   * can seat a connection it doesn't know yet: after a reconnect, a move queued while the
   * connection was down is sent before the room:rejoin that would otherwise have seated it.
   */
  code: string;
  token: string;
  action: OnlineAction;
}

export type JoinedReply = { ok: true; token: string; view: RoomView } | { ok: false; error: string };
/** A rejected action also brings the room as it really is, so the client can get back in sync. */
export type ActionReply = { ok: true } | { ok: false; error: string; view?: RoomView };

/** Client → server events. The last argument is Socket.IO's acknowledgement callback. */
export interface ClientToServerEvents {
  'room:create': (request: CreateRoomRequest, reply: (r: JoinedReply) => void) => void;
  'room:join': (request: JoinRoomRequest, reply: (r: JoinedReply) => void) => void;
  'room:rejoin': (request: RejoinRoomRequest, reply: (r: JoinedReply) => void) => void;
  'room:action': (request: ActionRequest, reply: (r: ActionReply) => void) => void;
  /** Ends the game: the opponent wins. */
  'room:resign': (request: SeatRequest, reply: (r: ActionReply) => void) => void;
  /** Offers a draw (accepts one, if the opponent offered first). */
  'room:offer-draw': (request: SeatRequest, reply: (r: ActionReply) => void) => void;
  'room:answer-draw': (request: SeatRequest & { accept: boolean }, reply: (r: ActionReply) => void) => void;
  /** Wins the game, once the opponent has been gone for `claimWinAfterMs`. */
  'room:claim-win': (request: SeatRequest, reply: (r: ActionReply) => void) => void;
  /** After the game: asks for a rematch (`yes`), or turns one down / takes the request back. */
  'room:rematch': (request: SeatRequest & { yes: boolean }, reply: (r: ActionReply) => void) => void;
  'room:leave': () => void;
}

/** Server → client events. */
export interface ServerToClientEvents {
  'room:update': (view: RoomView) => void;
}

export const DEFAULT_SERVER_PORT = 3000;
