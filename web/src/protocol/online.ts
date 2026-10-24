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
  lastAction: (OnlineAction & { by: Side }) | null;
}

export interface CreateRoomRequest {
  /** The side the room's creator plays; the friend who joins gets the other one. */
  side: Side;
  strictMode: boolean;
}

export interface JoinRoomRequest {
  code: string;
}

export interface RejoinRoomRequest {
  code: string;
  /** The secret handed out on create/join: proves it's the same player coming back. */
  token: string;
}

export interface ActionRequest {
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
  'room:leave': () => void;
}

/** Server → client events. */
export interface ServerToClientEvents {
  'room:update': (view: RoomView) => void;
}

export const DEFAULT_SERVER_PORT = 3000;
