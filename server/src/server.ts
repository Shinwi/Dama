import { createServer, Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { LIGHT, DARK, Side } from '../../web/src/engine/types';
import { ClientToServerEvents, ServerToClientEvents } from '../../web/src/protocol/online';
import { ServerMetrics } from './metrics';
import { FinishedGame, Room, RoomManager } from './rooms';
import { statsPage, statsSnapshot } from './stats';

const sideName = (side: Side) => (side === LIGHT ? 'white' : 'black');

/** How long an opponent must be gone before the other player can claim the win. */
const CLAIM_WIN_AFTER_MS = Number(process.env['CLAIM_WIN_AFTER_SECONDS'] ?? 300) * 1000;

/** How often the server checks for turns whose move timer has run out. */
const CLOCK_CHECK_MS = 250;

/** Rooms nobody has been connected to for this long are forgotten. */
const ROOM_IDLE_MS = 30 * 60 * 1000;
/**
 * Socket.IO's heartbeat: a ping every PING_INTERVAL_MS, and a connection that hasn't answered
 * within PING_TIMEOUT_MS more is taken as dead. The defaults (25 s + 20 s) leave a phone that
 * lost its signal looking connected for up to 45 s; this notices within about 20 s.
 */
const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 10_000;

/** The seat this connection is in: its room, and the seat's token (its side can change on a rematch). */
interface SocketData {
  code: string;
  token: string;
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
  options: {
    allowedOrigins?: AllowedOrigins;
    log?: Logger;
    nodeMetrics?: boolean;
    now?: () => number;
    claimWinAfterMs?: number;
  } = {},
): DamaServer {
  const allowedOrigins = options.allowedOrigins ?? true;
  const log = options.log ?? jsonLogger;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const rooms = new RoomManager(Math.random, now, options.claimWinAfterMs ?? CLAIM_WIN_AFTER_MS);
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

  /** A Socket.IO room per seat, named by its token: a rematch swaps sides, not tokens. */
  const channel = (code: string, token: string) => `${code}:${token}`;

  /** Sends each player in the room their own view of it. */
  const broadcast = (room: Room) => {
    for (const side of [LIGHT, DARK] as Side[]) {
      const seat = room.seats[side === LIGHT ? 'light' : 'dark'];
      if (seat) io.to(channel(room.code, seat.token)).emit('room:update', rooms.view(room, side));
    }
  };

  /**
   * Puts this connection in a seat. Doing it again for the seat it's already in changes
   * nothing: a queued move can seat a connection just before its own room:rejoin arrives.
   */
  const seat = (socket: DamaSocket, room: Room, token: string) => {
    if (socket.data.code === room.code && socket.data.token === token) return;
    leaveSeat(socket);
    socket.data.code = room.code;
    socket.data.token = token;
    void socket.join(channel(room.code, token));
    const side = rooms.sideOf(room, token);
    if (side !== null) rooms.setConnected(room, side, true);
  };

  const leaveSeat = (socket: DamaSocket, reason = 'left') => {
    const { code, token } = socket.data;
    if (!code || !token) return;
    void socket.leave(channel(code, token));
    socket.data = {};
    const room = roomOf(code);
    const side = room ? rooms.sideOf(room, token) : null;
    // Another tab may still hold the same seat (e.g. the page was reloaded).
    if (room && side !== null && (io.sockets.adapter.rooms.get(channel(code, token))?.size ?? 0) === 0) {
      rooms.setConnected(room, side, false);
      log('player_left', { room: code, side: sideName(side), reason });
      broadcast(room);
    }
  };

  /** The room and side this connection plays in now, if it's seated. */
  const seated = (socket: DamaSocket): { room: Room; side: Side } | null => {
    const { code, token } = socket.data;
    const room = code ? roomOf(code) : undefined;
    const side = room && token ? rooms.sideOf(room, token) : null;
    return room && side !== null ? { room, side } : null;
  };

  /**
   * The seat a request is for. Every request carries the seat's code and token, so a
   * connection that isn't seated yet (after a reconnect, a request queued while the
   * connection was down arrives before its room:rejoin) is seated from them first.
   * (An app from before code/token were sent: then only an already-seated connection works.)
   */
  const seatFor = (socket: DamaSocket, request: { code?: unknown; token?: unknown } | undefined) => {
    const requestedCode = String(request?.code ?? '');
    const seatedElsewhere = requestedCode !== '' && socket.data.code !== rooms.get(requestedCode)?.code;
    if (!socket.data.code || seatedElsewhere) {
      const back = rooms.rejoin(requestedCode, String(request?.token ?? ''));
      if (!back.ok) return back;
      seat(socket, back.value.room, String(request?.token));
      metrics.rejoined();
      log('player_rejoined', { room: back.value.room.code, side: sideName(back.value.side), byRequest: true });
      broadcast(back.value.room);
    }
    const here = seated(socket);
    return here ? ({ ok: true, value: here } as const) : ({ ok: false, error: 'You are not in a room.' } as const);
  };

  /** A game just ended (on the board or otherwise): count it and log it. */
  const gameEnded = (room: Room, finished: FinishedGame) => {
    metrics.gameFinished(finished);
    log('game_finished', {
      room: room.code,
      result: finished.result,
      seconds: Math.round(finished.durationMs / 1000),
      actions: finished.actions,
    });
  };

  const roomOf = (code: string) => rooms.get(code);

  io.on('connection', (socket: DamaSocket) => {
    socket.on('room:create', (request, reply) => {
      const side: Side = request?.side === DARK ? DARK : LIGHT;
      const { room, token } = rooms.create(side, request?.strictMode === true, Number(request?.moveTimeSeconds ?? 0) * 1000);
      seat(socket, room, token);
      metrics.roomCreated();
      metrics.playerSeen(request?.playerId);
      log('room_created', {
        room: room.code,
        side: sideName(side),
        strictMode: room.state.strictMode,
        moveTimeSeconds: room.moveTimeMs / 1000,
        rooms: rooms.size,
      });
      reply({ ok: true, token, view: rooms.view(room, side) });
    });

    socket.on('room:join', (request, reply) => {
      const joined = rooms.join(String(request?.code ?? ''));
      if (!joined.ok) {
        log('join_refused', { room: String(request?.code ?? ''), error: joined.error });
        return reply(joined);
      }
      const { room, side, token } = joined.value;
      seat(socket, room, token);
      metrics.gameStarted();
      metrics.playerSeen(request?.playerId);
      log('room_joined', { room: room.code, side: sideName(side) });
      reply({ ok: true, token, view: rooms.view(room, side) });
      broadcast(room); // the creator learns their friend is here
    });

    socket.on('room:rejoin', (request, reply) => {
      const token = String(request?.token ?? '');
      const back = rooms.rejoin(String(request?.code ?? ''), token);
      if (!back.ok) {
        log('rejoin_refused', { room: String(request?.code ?? ''), error: back.error });
        metrics.rejoinFailed();
        return reply(back);
      }
      const { room, side } = back.value;
      const already = socket.data.code === room.code && socket.data.token === token;
      seat(socket, room, token);
      if (!already) metrics.rejoined();
      metrics.playerSeen(request?.playerId);
      log('player_rejoined', { room: room.code, side: sideName(side), alreadySeated: already });
      reply({ ok: true, token, view: rooms.view(room, side) });
      broadcast(room);
    });

    socket.on('room:action', (request, reply) => {
      const here = seatFor(socket, request);
      if (!here.ok) {
        log('action_refused', { room: String(request?.code ?? ''), error: here.error });
        metrics.actionRefused(here.error);
        return reply({ ok: false, error: here.error });
      }
      const { room, side } = here.value;
      const played = rooms.play(room, side, request?.action);
      if (!played.ok) {
        log('action_refused', { room: room.code, side: sideName(side), error: played.error });
        metrics.actionRefused(played.error);
        return reply({ ok: false, error: played.error, view: rooms.view(room, side) });
      }
      metrics.actionPlayed(request.action.kind);
      if (played.value.finished) gameEnded(room, played.value.finished);
      reply({ ok: true });
      broadcast(room);
    });

    /**
     * The requests besides moves (resign, draws, claiming a win, rematches) all go the same
     * way: find the seat, ask RoomManager, reply, and send both players the new room.
     */
    const onSeatRequest = <R extends { code?: unknown; token?: unknown }>(
      event: string,
      handle: (room: Room, side: Side, request: R) => { ok: true } | { ok: false; error: string },
    ) =>
      (request: R, reply: (r: { ok: true } | { ok: false; error: string }) => void) => {
        const here = seatFor(socket, request);
        if (!here.ok) return reply({ ok: false, error: here.error });
        const { room, side } = here.value;
        const done = handle(room, side, request);
        if (!done.ok) {
          log('request_refused', { event, room: room.code, side: sideName(side), error: done.error });
          return reply(done);
        }
        reply({ ok: true });
        broadcast(room);
      };

    socket.on(
      'room:resign',
      onSeatRequest('room:resign', (room, side) => {
        const resigned = rooms.resign(room, side);
        if (!resigned.ok) return resigned;
        log('game_resigned', { room: room.code, side: sideName(side) });
        gameEnded(room, resigned.value);
        return { ok: true };
      }),
    );

    socket.on(
      'room:offer-draw',
      onSeatRequest('room:offer-draw', (room, side) => {
        const offered = rooms.offerDraw(room, side);
        if (!offered.ok) return offered;
        if (offered.value.finished) {
          metrics.drawAnswered(true);
          gameEnded(room, offered.value.finished);
        } else {
          metrics.drawOffered();
          log('draw_offered', { room: room.code, side: sideName(side) });
        }
        return { ok: true };
      }),
    );

    socket.on(
      'room:answer-draw',
      onSeatRequest<{ code?: unknown; token?: unknown; accept?: unknown }>('room:answer-draw', (room, side, request) => {
        const accept = request?.accept === true;
        const answered = rooms.answerDraw(room, side, accept);
        if (!answered.ok) return answered;
        metrics.drawAnswered(accept);
        log('draw_answered', { room: room.code, side: sideName(side), accept });
        if (answered.value.finished) gameEnded(room, answered.value.finished);
        return { ok: true };
      }),
    );

    socket.on(
      'room:claim-win',
      onSeatRequest('room:claim-win', (room, side) => {
        const claimed = rooms.claimWin(room, side);
        if (!claimed.ok) return claimed;
        log('win_claimed', { room: room.code, side: sideName(side) });
        gameEnded(room, claimed.value);
        return { ok: true };
      }),
    );

    socket.on(
      'room:rematch',
      onSeatRequest<{ code?: unknown; token?: unknown; yes?: unknown }>('room:rematch', (room, side, request) => {
        const yes = request?.yes === true;
        const answered = rooms.rematch(room, side, yes);
        if (!answered.ok) return answered;
        if (answered.value.started) {
          metrics.rematchStarted();
          metrics.gameStarted();
          log('rematch_started', { room: room.code, game: room.game });
        } else {
          log(yes ? 'rematch_asked' : 'rematch_declined', { room: room.code, side: sideName(side) });
        }
        return { ok: true };
      }),
    );

    socket.on('room:leave', () => {
      // Leaving on purpose takes back any rematch request: the other player isn't left waiting.
      const here = seated(socket);
      if (here && rooms.isOver(here.room)) rooms.rematch(here.room, here.side, false);
      leaveSeat(socket, 'left the room');
    });
    socket.on('disconnect', (reason) => leaveSeat(socket, reason));
  });

  // The move timer: skip the turns that have run out, and tell both players.
  const clock = setInterval(() => {
    for (const { room, finished } of rooms.expireTurns()) {
      metrics.turnTimedOut();
      log('turn_timed_out', { room: room.code, side: sideName(room.lastAction!.by) });
      if (finished) gameEnded(room, finished);
      broadcast(room);
    }
  }, CLOCK_CHECK_MS);
  clock.unref();

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
        clearInterval(clock);
        void io.close(() => resolve());
      }),
  };
}
