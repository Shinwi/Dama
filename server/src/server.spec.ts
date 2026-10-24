import { AddressInfo } from 'node:net';
import { io as connect, Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSquare } from '../../web/src/engine/board';
import { DARK, LIGHT } from '../../web/src/engine/types';
import { ClientToServerEvents, JoinedReply, RoomView, ServerToClientEvents } from '../../web/src/protocol/online';
import { createDamaServer, DamaServer, originAllowed } from './server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A real server on a free port, and real Socket.IO clients talking to it. */
describe('Dama server over Socket.IO', () => {
  let server: DamaServer;
  let url: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    server = createDamaServer();
    await new Promise<void>((resolve) => server.http.listen(0, resolve));
    url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await server.close();
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
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')] },
    });
    expect(played).toEqual({ ok: true });
    const view = await blackSeesMove;
    expect(view.seq).toBe(1);
    expect(view.lastAction).toEqual({ kind: 'move', path: [parseSquare('b4'), parseSquare('a5')], by: LIGHT });
    expect(view.state.toMove).toBe(DARK);
    expect(view.state.board[parseSquare('a5')]).toBe(1);
  });

  it('rejects an illegal move and sends the real position back', async () => {
    const white = client();
    const created = (await white.emitWithAck('room:create', { side: LIGHT, strictMode: false })) as Extract<JoinedReply, { ok: true }>;
    await client().emitWithAck('room:join', { code: created.view.code });

    const reply = await white.emitWithAck('room:action', {
      action: { kind: 'move', path: [parseSquare('b4'), parseSquare('b5')] },
    });
    expect(reply.ok).toBe(false);
    expect(!reply.ok && reply.view?.seq).toBe(0);
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
    const server = createDamaServer({ allowedOrigins: ['https://shinwi.github.io'] });
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
