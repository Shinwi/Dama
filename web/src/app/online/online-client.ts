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

/** How long to wait for the server to answer before giving up on a request. */
const REPLY_TIMEOUT_MS = 5000;

export type ConnectionState = 'connected' | 'reconnecting';

/**
 * Where the online server is. `?server=http://host:port` in the page URL wins; otherwise
 * it's port 3000 on the same machine the page came from, so a phone on the same Wi-Fi that
 * opened http://<your-computer>:4200 finds the server on <your-computer>:3000 too.
 */
export function onlineServerUrl(location: Pick<Location, 'search' | 'protocol' | 'hostname'> = window.location): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) return fromQuery;
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

  constructor(url: string) {
    this.socket = io(url, { transports: ['websocket'] });
    this.socket.on('room:update', (view) => this.onUpdate(view));
    this.socket.on('connect', () => {
      this.onConnection('connected', this.connectedOnce);
      this.connectedOnce = true;
    });
    this.socket.on('disconnect', () => this.onConnection('reconnecting', false));
  }

  create(side: Side, strictMode: boolean): Promise<JoinedReply> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:create', { side, strictMode }));
  }

  join(code: string): Promise<JoinedReply> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:join', { code }));
  }

  rejoin(code: string, token: string): Promise<JoinedReply> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:rejoin', { code, token }));
  }

  act(action: OnlineAction): Promise<ActionReply> {
    return this.request(() => this.socket.timeout(REPLY_TIMEOUT_MS).emitWithAck('room:action', { action }));
  }

  /** Leaves the room and closes the connection. */
  close(): void {
    this.socket.emit('room:leave');
    this.socket.disconnect();
  }

  private async request<T extends { ok: boolean }>(send: () => Promise<T>): Promise<T | { ok: false; error: string }> {
    try {
      return await send();
    } catch {
      return { ok: false, error: "Can't reach the online server. Is it running?" };
    }
  }
}
