import { createServer, Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { LIGHT, DARK, Side } from '../../web/src/engine/types';
import { ClientToServerEvents, ServerToClientEvents } from '../../web/src/protocol/online';
import { Room, RoomManager } from './rooms';

/** Rooms nobody has been connected to for this long are forgotten. */
const ROOM_IDLE_MS = 30 * 60 * 1000;

interface SocketData {
  code: string;
  side: Side;
}

type DamaSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Partial<SocketData>>;

export interface DamaServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  close(): Promise<void>;
}

/**
 * The online server: Socket.IO in front of RoomManager. Each player's socket joins a
 * Socket.IO room per seat (`AB12:light`), so each side can be sent its own view.
 */
export function createDamaServer(options: { corsOrigin?: string | string[] | boolean } = {}): DamaServer {
  const rooms = new RoomManager();
  const http = createServer((req, res) => {
    // A plain page for "is the server up?" checks (and later, the host's health check).
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Dama server: ${rooms.size} room(s) open\n`);
  });
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, Partial<SocketData>>(http, {
    cors: { origin: options.corsOrigin ?? true },
  });

  const channel = (code: string, side: Side) => `${code}:${side === LIGHT ? 'light' : 'dark'}`;

  /** Sends each player in the room their own view of it. */
  const broadcast = (room: Room) => {
    for (const side of [LIGHT, DARK] as Side[]) {
      io.to(channel(room.code, side)).emit('room:update', rooms.view(room, side));
    }
  };

  const seat = (socket: DamaSocket, room: Room, side: Side) => {
    leaveSeat(socket);
    socket.data.code = room.code;
    socket.data.side = side;
    void socket.join(channel(room.code, side));
  };

  const leaveSeat = (socket: DamaSocket) => {
    const { code, side } = socket.data;
    if (!code || side === undefined) return;
    void socket.leave(channel(code, side));
    socket.data = {};
    const room = roomOf(code);
    // Another tab may still hold the same seat (e.g. the page was reloaded).
    if (room && (io.sockets.adapter.rooms.get(channel(code, side))?.size ?? 0) === 0) {
      rooms.setConnected(room, side, false);
      broadcast(room);
    }
  };

  const roomOf = (code: string) => rooms.get(code);

  io.on('connection', (socket: DamaSocket) => {
    socket.on('room:create', (request, reply) => {
      const side: Side = request?.side === DARK ? DARK : LIGHT;
      const { room, token } = rooms.create(side, request?.strictMode === true);
      seat(socket, room, side);
      reply({ ok: true, token, view: rooms.view(room, side) });
    });

    socket.on('room:join', (request, reply) => {
      const joined = rooms.join(String(request?.code ?? ''));
      if (!joined.ok) return reply(joined);
      const { room, side, token } = joined.value;
      seat(socket, room, side);
      reply({ ok: true, token, view: rooms.view(room, side) });
      broadcast(room); // the creator learns their friend is here
    });

    socket.on('room:rejoin', (request, reply) => {
      const back = rooms.rejoin(String(request?.code ?? ''), String(request?.token ?? ''));
      if (!back.ok) return reply(back);
      const { room, side } = back.value;
      seat(socket, room, side);
      reply({ ok: true, token: request.token, view: rooms.view(room, side) });
      broadcast(room);
    });

    socket.on('room:action', (request, reply) => {
      const { code, side } = socket.data;
      const room = code ? roomOf(code) : undefined;
      if (!room || side === undefined) return reply({ ok: false, error: 'You are not in a room.' });
      const played = rooms.play(room, side, request?.action);
      if (!played.ok) return reply({ ok: false, error: played.error, view: rooms.view(room, side) });
      reply({ ok: true });
      broadcast(room);
    });

    socket.on('room:leave', () => leaveSeat(socket));
    socket.on('disconnect', () => leaveSeat(socket));
  });

  const sweeper = setInterval(() => rooms.sweep(ROOM_IDLE_MS), 60_000);
  sweeper.unref();

  return {
    http,
    io,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        void io.close(() => resolve());
      }),
  };
}
