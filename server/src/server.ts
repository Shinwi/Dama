import { createServer, Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { LIGHT, DARK, Side } from '../../web/src/engine/types';
import { ClientToServerEvents, ServerToClientEvents } from '../../web/src/protocol/online';
import { ServerMetrics } from './metrics';
import { Room, RoomManager } from './rooms';
import { statsPage, statsSnapshot } from './stats';

const sideName = (side: Side) => (side === LIGHT ? 'white' : 'black');

/** Rooms nobody has been connected to for this long are forgotten. */
const ROOM_IDLE_MS = 30 * 60 * 1000;
/**
 * Socket.IO's heartbeat: a ping every PING_INTERVAL_MS, and a connection that hasn't answered
 * within PING_TIMEOUT_MS more is taken as dead. The defaults (25 s + 20 s) leave a phone that
 * lost its signal looking connected for up to 45 s; this notices within about 20 s.
 */
const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 10_000;

interface SocketData {
  code: string;
  side: Side;
}

type DamaSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Partial<SocketData>>;

export interface DamaServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  metrics: ServerMetrics;
  close(): Promise<void>;
}

/**
 * Which web pages may connect: `true` for any (fine on your own machine), or a list of
 * origins such as `https://shinwi.github.io` (when hosted).
 */
export type AllowedOrigins = true | string[];

/**
 * Whether a connection from `origin` (the page's Origin header) is allowed. Socket.IO's CORS
 * setting alone doesn't stop WebSocket connections, which browsers don't apply CORS to, so
 * this is checked on every connection as well.
 */
export function originAllowed(allowed: AllowedOrigins, origin: string | undefined): boolean {
  return allowed === true || (origin !== undefined && allowed.includes(origin));
}

/** One line of the server's log: an event name plus details, printed as JSON. */
export type Logger = (event: string, details?: Record<string, unknown>) => void;

/** JSON lines on stdout, which `fly logs` shows: easy to read, and to search. */
export const jsonLogger: Logger = (event, details = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));

/**
 * The online server: Socket.IO in front of RoomManager. Each player's socket joins a
 * Socket.IO room per seat (`AB12:light`), so each side can be sent its own view.
 */
export function createDamaServer(
  options: { allowedOrigins?: AllowedOrigins; log?: Logger; nodeMetrics?: boolean; now?: () => number } = {},
): DamaServer {
  const allowedOrigins = options.allowedOrigins ?? true;
  const log = options.log ?? jsonLogger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const rooms = new RoomManager(Math.random, now);
  const metrics = new ServerMetrics(() => rooms.counts(), { now, nodeMetrics: options.nodeMetrics });
  const http = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/stats.json' || path === '/stats') {
      // Public: counts only, nothing about who is playing.
      const snapshot = statsSnapshot(rooms.counts(), metrics.today, startedAt, now());
      const json = path === '/stats.json';
      res.writeHead(200, {
        'content-type': json ? 'application/json' : 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(json ? JSON.stringify(snapshot) : statsPage(snapshot));
      return;
    }
    if (req.url === '/health') {
      // The web app asks this before it shows its Online button, from another origin (the
      // page's), so the answer has to allow that.
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    // A plain page for a person checking the server is up.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Dama server: ${rooms.size} room(s) open\n`);
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Partial<SocketData>>(http, {
    cors: { origin: allowedOrigins },
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
    allowRequest: (req, callback) => callback(null, originAllowed(allowedOrigins, req.headers.origin)),
  });

  const channel = (code: string, side: Side) => `${code}:${side === LIGHT ? 'light' : 'dark'}`;

  /** Sends each player in the room their own view of it. */
  const broadcast = (room: Room) => {
    for (const side of [LIGHT, DARK] as Side[]) {
      io.to(channel(room.code, side)).emit('room:update', rooms.view(room, side));
    }
  };

  /**
   * Puts this connection in a seat. Doing it again for the seat it's already in changes
   * nothing: a queued move can seat a connection just before its own room:rejoin arrives.
   */
  const seat = (socket: DamaSocket, room: Room, side: Side) => {
    if (socket.data.code === room.code && socket.data.side === side) return;
    leaveSeat(socket);
    socket.data.code = room.code;
    socket.data.side = side;
    void socket.join(channel(room.code, side));
    rooms.setConnected(room, side, true);
  };

  const leaveSeat = (socket: DamaSocket, reason = 'left') => {
    const { code, side } = socket.data;
    if (!code || side === undefined) return;
    void socket.leave(channel(code, side));
    socket.data = {};
    const room = roomOf(code);
    // Another tab may still hold the same seat (e.g. the page was reloaded).
    if (room && (io.sockets.adapter.rooms.get(channel(code, side))?.size ?? 0) === 0) {
      rooms.setConnected(room, side, false);
      log('player_left', { room: code, side: sideName(side), reason });
      broadcast(room);
    }
  };

  const roomOf = (code: string) => rooms.get(code);

  io.on('connection', (socket: DamaSocket) => {
    socket.on('room:create', (request, reply) => {
      const side: Side = request?.side === DARK ? DARK : LIGHT;
      const { room, token } = rooms.create(side, request?.strictMode === true);
      seat(socket, room, side);
      metrics.roomCreated();
      metrics.playerSeen(request?.playerId);
      log('room_created', { room: room.code, side: sideName(side), strictMode: room.state.strictMode, rooms: rooms.size });
      reply({ ok: true, token, view: rooms.view(room, side) });
    });

    socket.on('room:join', (request, reply) => {
      const joined = rooms.join(String(request?.code ?? ''));
      if (!joined.ok) {
        log('join_refused', { room: String(request?.code ?? ''), error: joined.error });
        return reply(joined);
      }
      const { room, side, token } = joined.value;
      seat(socket, room, side);
      metrics.gameStarted();
      metrics.playerSeen(request?.playerId);
      log('room_joined', { room: room.code, side: sideName(side) });
      reply({ ok: true, token, view: rooms.view(room, side) });
      broadcast(room); // the creator learns their friend is here
    });

    socket.on('room:rejoin', (request, reply) => {
      const back = rooms.rejoin(String(request?.code ?? ''), String(request?.token ?? ''));
      if (!back.ok) {
        log('rejoin_refused', { room: String(request?.code ?? ''), error: back.error });
        metrics.rejoinFailed();
        return reply(back);
      }
      const { room, side } = back.value;
      const already = socket.data.code === room.code && socket.data.side === side;
      seat(socket, room, side);
      if (!already) metrics.rejoined();
      metrics.playerSeen(request?.playerId);
      log('player_rejoined', { room: room.code, side: sideName(side), alreadySeated: already });
      reply({ ok: true, token: request.token, view: rooms.view(room, side) });
      broadcast(room);
    });

    socket.on('room:action', (request, reply) => {
      // Not seated yet: after a reconnect, a move queued while the connection was down arrives
      // before the room:rejoin. Its code and token say which seat it's for.
      // (An app from before this change sends no code: then only an already-seated connection works.)
      const requestedCode = String(request?.code ?? '');
      const seatedElsewhere = requestedCode !== '' && socket.data.code !== rooms.get(requestedCode)?.code;
      if (!socket.data.code || seatedElsewhere) {
        const back = rooms.rejoin(requestedCode, String(request?.token ?? ''));
        if (!back.ok) {
          log('action_refused', { room: requestedCode, error: back.error });
          metrics.actionRefused(back.error);
          return reply({ ok: false, error: back.error });
        }
        seat(socket, back.value.room, back.value.side);
        metrics.rejoined();
        log('player_rejoined', { room: back.value.room.code, side: sideName(back.value.side), byAction: true });
        broadcast(back.value.room);
      }
      const { code, side } = socket.data;
      const room = code ? roomOf(code) : undefined;
      if (!room || side === undefined) return reply({ ok: false, error: 'You are not in a room.' });
      const played = rooms.play(room, side, request?.action);
      if (!played.ok) {
        log('action_refused', { room: room.code, side: sideName(side), error: played.error });
        metrics.actionRefused(played.error);
        return reply({ ok: false, error: played.error, view: rooms.view(room, side) });
      }
      const finished = played.value.finished;
      metrics.actionPlayed(request.action.kind, finished);
      if (finished) log('game_finished', { room: room.code, result: finished.result, seconds: Math.round(finished.durationMs / 1000), actions: finished.actions });
      reply({ ok: true });
      broadcast(room);
    });

    socket.on('room:leave', () => leaveSeat(socket, 'left the room'));
    socket.on('disconnect', (reason) => leaveSeat(socket, reason));
  });

  const sweeper = setInterval(() => {
    const removed = rooms.sweep(ROOM_IDLE_MS);
    if (removed > 0) log('rooms_removed', { removed, rooms: rooms.size });
  }, 60_000);
  sweeper.unref();

  return {
    http,
    io,
    rooms,
    metrics,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        void io.close(() => resolve());
      }),
  };
}
