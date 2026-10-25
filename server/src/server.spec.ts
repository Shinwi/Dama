import { AddressInfo } from 'node:net';
import { io as connect, Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSquare } from '../../web/src/engine/board';
import { DARK, LIGHT } from '../../web/src/engine/types';
import { ClientToServerEvents, JoinedReply, RoomView, ServerToClientEvents } from '../../web/src/protocol/online';
import { createMetricsServer } from './metrics';
import { createDamaServer, DamaServer, originAllowed } from './server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A real server on a free port, and real Socket.IO clients talking to it. */
describe('Dama server over Socket.IO', () => {
  let server: DamaServer;
  let url: string;
  const clients: Client[] = [];
  let logged: Record<string, unknown>[] = [];

  beforeEach(async () => {
    server = createDamaServer({ log: (event, details) => logged.push({ event, ...details }), nodeMetrics: false });
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
    logged = [];
  });

  function client(): Client {
    const socket: Client = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    return socket;
  }

  /** Resolves with the next room:update this client receives that passes `test`. */
  const updateWhere = (socket: Client, test: (view: RoomView) => boolean) =>
    new Promise<RoomView>((resolve) => {
      const listener = (view: RoomView) => {
        if (!test(view)) return;
        socket.off('room:update', listener);
        resolve(view);
      };
      socket.on('room:update', listener);
    });

  it('answers /health, readable from any web page', async () => {
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('counts a game on /stats.json and /metrics, without codes, tokens or player IDs', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', {
      side: LIGHT,
      strictMode: false,
      playerId: 'aaaaaaaa-1111',
    })) as Extract<JoinedReply, { ok: true }>;
    const joined = (await client().emitWithAck('room:join', {
      code: created.view.code,
      playerId: 'bbbbbbbb-2222',
    })) as Extract<JoinedReply, { ok: true }>;
    await white.emitWithAck('room:action', {
      code: created.view.code,
      token: created.token,
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] },
    });

    const response = await fetch(`${url}/stats.json`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const stats = await response.json();
    expect(stats.now).toEqual({ roomsOpen: 1, roomsWaiting: 0, roomsActive: 1, playersConnected: 2 });
    expect(stats.today).toMatchObject({ roomsCreated: 1, gamesStarted: 1, gamesFinished: 0, uniquePlayers: 2 });

    const page = await (await fetch(`${url}/stats`)).text();
    expect(page).toContain('Players connected');

    const metricsServer = createMetricsServer(server.metrics);
    await new Promise<void>((resolve) => metricsServer.listen(0, resolve));
    try {
      const metricsUrl = `http://localhost:${(metricsServer.address() as AddressInfo).port}`;
      const text = await (await fetch(`${metricsUrl}/metrics`)).text();
      expect(text).toContain('dama_moves_total{kind="move"} 1');
      expect(text).toContain('dama_unique_players_today 2');
      expect((await fetch(`${metricsUrl}/other`)).status).toBe(404);
      for (const secret of [created.view.code, created.token, joined.token, 'aaaaaaaa-1111']) {
        expect(text).not.toContain(secret);
        expect(JSON.stringify(stats) + page).not.toContain(secret);
      }
    } finally {
      metricsServer.close();
    }
  });

  it('two players create and join a room, and a move reaches the other player', async () => {
    const white = client();
    const black = client();

    const created = await white.emitWithAck('room:create', { side: LIGHT, strictMode: false });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.view.opponentJoined).toBe(false);

    const whiteSeesJoin = updateWhere(white, (v) => v.opponentJoined);
    const joined = await black.emitWithAck('room:join', { code: created.view.code });
    expect(joined.ok && joined.view.yourSide).toBe(DARK);
    expect((await whiteSeesJoin).opponentJoined).toBe(true);

    const blackSeesMove = updateWhere(black, (v) => v.seq === 1);
    const played = await white.emitWithAck('room:action', {
      code: created.view.code,
      token: created.token,
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] },
    });
    expect(played).toEqual({ ok: true });
    const view = await blackSeesMove;
    expect(view.seq).toBe(1);
    expect(view.lastAction).toEqual({ kind: 'move', path: [parseSquare('b4'), parseSquare('a5')], by: LIGHT });
    expect(view.state.toMove).toBe(DARK);
    expect(view.state.board[parseSquare('a5')]).toBe(1);
  });

  it('skips a turn when the move timer runs out, and tells both players', async () => {
    const white = client();
    const black = client();
    // A tiny timer (0.2 s, plus the server's 1 s grace), so the test doesn't wait long.
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false, moveTimeSeconds: 0.2 })) as Extract<
      JoinedReply,
      { ok: true }
    >;
    expect(created.view.moveTimeMs).toBe(200);
    const blackSeesTimeout = updateWhere(black, (v) => v.lastAction?.kind === 'timeout');
    await black.emitWithAck('room:join', { code: created.view.code });

    const view = await blackSeesTimeout;
    expect(view.lastAction).toEqual({ kind: 'timeout', by: LIGHT });
    expect(view.state.toMove).toBe(DARK);
    expect(view.state.timeouts).toEqual({ light: 1, dark: 0 });
    expect(logged.some((l) => l['event'] === 'turn_timed_out' && l['side'] === 'white')).toBe(true);
  });

  it('rejects an illegal move and sends the real position back', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    await client().emitWithAck('room:join', { code: created.view.code });

    const reply = await white.emitWithAck('room:action', {
      code: created.view.code,
      token: created.token,
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('b5')] },
    });
    expect(reply.ok).toBe(false);
    expect(!reply.ok && reply.view?.seq).toBe(0);
  });

  // Issue #36: on a phone, the connection drops (screen locked, app switched); a move made
  // then is queued and sent on reconnect *before* the room:rejoin that seats the connection.
  it('accepts a move sent while the connection was down, once it is back', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    const black = client();
    const joined = (await black.emitWithAck('room:join', { code: created.view.code })) as Extract<JoinedReply, { ok: true }>;
    const code = created.view.code;
    // Like the web app: on every reconnect, tell the server which seat this is.
    black.on('connect', () => void black.emitWithAck('room:rejoin', { code, token: joined.token }));
    await white.emitWithAck('room:action', { code, token: created.token, action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] } });

    black.io.engine.close(); // the connection drops
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(black.connected).toBe(false);
    const whiteSeesReply = updateWhere(white, (v) => v.seq === 2);
    const reply = await black.timeout(5000).emitWithAck('room:action', {
      code,
      token: joined.token,
      action: { kind: 'move', path: [parseSquare('c7'), parseSquare('d6')] },
    });

    expect(reply).toEqual({ ok: true });
    const view = await whiteSeesReply;
    expect(view.state.board[parseSquare('d6')]).toBe(-1);
    // Black's room:rejoin arrives after the move seated it: Black stays connected.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.rooms.view(server.rooms.get(code)!, LIGHT).opponentConnected).toBe(true);
    expect(logged.some((l) => l['event'] === 'player_rejoined' && l['byRequest'] === true)).toBe(true);
  });

  it('refuses a move whose token is not the seat it claims', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    await client().emitWithAck('room:join', { code: created.view.code });

    const stranger = client();
    const reply = await stranger.emitWithAck('room:action', {
      code: created.view.code,
      token: 'not-the-token',
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] },
    });
    expect(reply).toEqual({ ok: false, error: 'That game is no longer available.' });
  });

  it('logs rooms being created, joined and left, without the secret tokens', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    const black = client();
    const joined = (await black.emitWithAck('room:join', { code: created.view.code })) as Extract<JoinedReply, { ok: true }>;
    const whiteSeesDrop = updateWhere(white, (v) => !v.opponentConnected);
    black.disconnect();
    await whiteSeesDrop;

    expect(logged.map((l) => l['event'])).toEqual(['room_created', 'room_joined', 'player_left']);
    expect(logged[2]).toMatchObject({ room: created.view.code, side: 'black', reason: 'client namespace disconnect' });
    expect(JSON.stringify(logged)).not.toContain(created.token);
    expect(JSON.stringify(logged)).not.toContain(joined.token);
  });

  it('tells a player when the opponent drops, and lets the opponent back in', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    const black = client();
    const joined = (await black.emitWithAck('room:join', { code: created.view.code })) as Extract<JoinedReply, { ok: true }>;

    const whiteSeesDrop = updateWhere(white, (v) => !v.opponentConnected);
    black.disconnect();
    expect((await whiteSeesDrop).opponentConnected).toBe(false);

    const whiteSeesReturn = updateWhere(white, (v) => v.opponentConnected);
    const back = await client().emitWithAck('room:rejoin', { code: created.view.code, token: joined.token });
    expect(back.ok && back.view.yourSide).toBe(DARK);
    expect((await whiteSeesReturn).opponentConnected).toBe(true);
  });
});

describe('originAllowed', () => {
  it('allows any page when no list is set, and only listed pages otherwise', () => {
    expect(originAllowed(true, undefined)).toBe(true);
    expect(originAllowed(['https://shinwi.github.io'], 'https://shinwi.github.io')).toBe(true);
    expect(originAllowed(['https://shinwi.github.io'], 'https://evil.example')).toBe(false);
    expect(originAllowed(['https://shinwi.github.io'], undefined)).toBe(false);
  });
});

describe('Dama server with a list of allowed pages', () => {
  it('turns away connections from other pages', async () => {
    const server = createDamaServer({ allowedOrigins: ['https://shinwi.github.io'], log: () => {}, nodeMetrics: false });
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    const url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
    const connectFrom = (origin: string) =>
      new Promise<boolean>((resolve) => {
        const socket = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { origin }, reconnection: false });
        socket.on('connect', () => {
          socket.disconnect();
          resolve(true);
        });
        socket.on('connect_error', () => resolve(false));
      });
    try {
      expect(await connectFrom('https://shinwi.github.io')).toBe(true);
      expect(await connectFrom('https://evil.example')).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('Dama server: ending a game and a rematch, over Socket.IO', () => {
  it('resign, then a rematch from both, then the new White moves first', async () => {
    const server = createDamaServer({ log: () => {}, nodeMetrics: false });
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    const url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
    const open = (): Client => connect(url, { transports: ['websocket'], forceNew: true });
    const a = open();
    const b = open();
    const next = (socket: Client, test: (v: RoomView) => boolean) =>
      new Promise<RoomView>((resolve) => {
        const listener = (v: RoomView) => {
          if (!test(v)) return;
          socket.off('room:update', listener);
          resolve(v);
        };
        socket.on('room:update', listener);
      });
    try {
      const created = (await a.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
      const code = created.view.code;
      const joined = (await b.emitWithAck('room:join', { code })) as Extract<JoinedReply, { ok: true }>;
      const seatA = { code, token: created.token };
      const seatB = { code, token: joined.token };

      const bSeesResign = next(b, (v) => v.result !== null);
      expect(await a.emitWithAck('room:resign', seatA)).toEqual({ ok: true });
      expect((await bSeesResign).result).toEqual({ kind: 'resigned', winner: DARK });

      const aSeesAsk = next(a, (v) => v.rematch.opponent);
      expect(await b.emitWithAck('room:rematch', { ...seatB, yes: true })).toEqual({ ok: true });
      await aSeesAsk;
      const bSeesNewGame = next(b, (v) => v.game === 1);
      expect(await a.emitWithAck('room:rematch', { ...seatA, yes: true })).toEqual({ ok: true });
      const newGame = await bSeesNewGame;
      expect(newGame.yourSide).toBe(LIGHT); // B was Black, now White
      expect(newGame.result).toBeNull();

      // B (now White) opens; A (now Black) can't.
      const refused = await a.emitWithAck('room:action', { ...seatA, action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] } });
      expect(refused.ok).toBe(false);
      const played = await b.emitWithAck('room:action', { ...seatB, action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] } });
      expect(played).toEqual({ ok: true });
      expect(await server.metrics.render()).toContain('dama_rematches_total 1');
    } finally {
      a.disconnect();
      b.disconnect();
      await server.close();
    }
  });
});
