import { io, Socket } from 'socket.io-client';
import { Side } from '../../engine/types';
import {
  ActionReply,
  ClientToServerEvents,
  DEFAULT_SERVER_PORT,
  JoinedReply,
  OnlineAction,
  RoomView,
  ServerToClientEvents,
} from '../../protocol/online';
import { HOSTED_SERVER_URL } from './server-config';

/** How long to wait for the server to answer before giving up on a request. */
const REPLY_TIMEOUT_MS = 5000;

export type ConnectionState = 'connected' | 'reconnecting';

/**
 * The server didn't answer in time (the connection is down, or it's gone). Not a refusal:
 * the request may still arrive once the connection is back, so the caller shouldn't treat
 * it as "the server said no".
 */
export interface Unreachable {
  ok: false;
  error: string;
  unreachable: true;
}

/**
 * Where the online server is:
 * - `?server=http://host:port` in the page URL, if given;
 * - otherwise, on an https page (the live site, PR previews), the hosted server;
 * - otherwise (http: your own machine), port 3000 on the same host the page came from, so
 *   a phone on the same Wi-Fi that opened http://<your-computer>:4200 finds the server on
 *   <your-computer>:3000 too.
 */
export function onlineServerUrl(location: Pick<Location, 'search' | 'protocol' | 'hostname'> = window.location): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) return fromQuery;
  if (location.protocol === 'https:') return HOSTED_SERVER_URL;
  return `${location.protocol}//${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

/** How long the "is the server there?" check waits before taking silence for a no. */
export const SERVER_CHECK_TIMEOUT_MS = 2000;

/**
 * Asks the server's `/health` address whether it's up. Resolves false on any error, an
 * answer that isn't the server's, or no answer within `timeoutMs`; it never throws. Plain
 * HTTP, not Socket.IO, so it's cheap to ask each time the home screen is shown.
 */
export async function checkOnlineServer(
  url: string,
  timeoutMs = SERVER_CHECK_TIMEOUT_MS,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${url.replace(/\/+$/, '')}/health`, { signal: abort.signal, cache: 'no-store' });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Thin wrapper around the Socket.IO connection to the online server. Requests come back as
 * promises; a server that doesn't answer in time counts as unreachable. GameService owns
 * the game logic; this only carries messages.
 */
export class OnlineClient {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private connectedOnce = false;

  /** Called with every room update the server sends. */
  onUpdate: (view: RoomView) => void = () => {};
  /** Called when the connection drops and when it comes back (`reconnected` true then). */
  onConnection: (state: ConnectionState, reconnected: boolean) => void = () => {};

  /** `playerId`: this browser's anonymous ID (see player-id.ts), sent so the server can count players. */
  constructor(
    url: string,
    private readonly playerId?: string,
  ) {
    this.socket = io(url, { transports: ['websocket'] });
    this.socket.on('room:update', (view) => this.onUpdate(view));
    this.socket.on('connect', () => {
      this.onConnection('connected', this.connectedOnce);
      this.connectedOnce = true;
    });
    this.socket.on('disconnect', () => this.onConnection('reconnecting', false));
  }

  create(side: Side, strictMode: boolean): Promise<JoinedReply | Unreachable> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:create', { side, strictMode, playerId: this.playerId }));
  }

  join(code: string): Promise<JoinedReply | Unreachable> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:join', { code, playerId: this.playerId }));
  }

  rejoin(code: string, token: string): Promise<JoinedReply | Unreachable> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:rejoin', { code, token, playerId: this.playerId }));
  }

  /** Sends an action for the seat `code`/`token` (see ActionRequest for why it says which). */
  act(code: string, token: string, action: OnlineAction): Promise<ActionReply | Unreachable> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:action', { code, token, action }));
  }

  /** Leaves the room and closes the connection. */
  close(): void {
    this.socket.emit('room:leave');
    this.socket.disconnect();
  }

  private async request<T extends { ok: boolean }>(send: () => Promise<T>): Promise<T | Unreachable> {
    try {
      return await send();
    } catch {
      return { ok: false, error: "Can't reach the online server. Is it running?", unreachable: true };
    }
  }
}
