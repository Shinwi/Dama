import { describe, expect, it } from 'vitest';
import { boardFrom, parseSquare } from '../../web/src/engine/board';
import { DARK, LIGHT } from '../../web/src/engine/types';
import { ROOM_FULL, RoomManager } from './rooms';

const sq = parseSquare;

function twoPlayers(manager = new RoomManager()) {
  const { room, token: whiteToken } = manager.create(LIGHT, false);
  const joined = manager.join(room.code);
  if (!joined.ok) throw new Error(joined.error);
  return { manager, room, whiteToken, blackToken: joined.value.token };
}

describe('RoomManager', () => {
  it('creates a room with a 4-character code, waiting for a second player', () => {
    const manager = new RoomManager();
    const { room } = manager.create(LIGHT, false);
    expect(room.code).toMatch(/^[A-Z2-9]{4}$/);
    const view = manager.view(room, LIGHT);
    expect(view.yourSide).toBe(LIGHT);
    expect(view.opponentJoined).toBe(false);
    expect(view.state.board).toHaveLength(100);
  });

  it('gives the friend who joins the other side, whatever case they type the code in', () => {
    const manager = new RoomManager();
    const { room } = manager.create(DARK, false);
    const joined = manager.join(` ${room.code.toLowerCase()} `);
    expect(joined.ok && joined.value.side).toBe(LIGHT);
    expect(manager.view(room, DARK).opponentJoined).toBe(true);
  });

  it('turns away a wrong code and a third player', () => {
    const { manager, room } = twoPlayers();
    expect(manager.join('ZZZZ')).toEqual({ ok: false, error: 'No room with that code.' });
    expect(manager.join(room.code)).toEqual({ ok: false, error: ROOM_FULL });
  });

  it('never hands out a code that is already in use', () => {
    // A "random" source that keeps giving the same code, then a different one.
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    const manager = new RoomManager(() => values.shift() ?? 0.9);
    const first = manager.create(LIGHT, false).room.code;
    const second = manager.create(LIGHT, false).room.code;
    expect(second).not.toBe(first);
  });

  it('plays legal moves in turn and refuses anything else', () => {
    const { manager, room } = twoPlayers();
    expect(manager.play(room, DARK, { kind: 'move', path: [sq('c7'), sq('d6')] })).toEqual({ ok: false, error: 'Not your turn.' });
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('b5')] })).toEqual({ ok: false, error: 'Illegal move.' });
    expect(manager.play(room, LIGHT, { kind: 'move', path: 'b4-a5' })).toEqual({ ok: false, error: 'Not a valid action.' });
    expect(room.seq).toBe(0);

    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('a5')] }).ok).toBe(true);
    expect(room.seq).toBe(1);
    expect(room.state.toMove).toBe(DARK);
    expect(room.lastAction).toEqual({ kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT });
  });

  it('waits for the second player before anyone can move', () => {
    const manager = new RoomManager();
    const { room } = manager.create(LIGHT, false);
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('a5')] }).ok).toBe(false);
  });

  it('lets the opponent take a piece that skipped a capture, then move', () => {
    const { manager, room } = twoPlayers();
    // White c3 could take d4 but plays a1-b2.
    room.state = { ...room.state, board: boardFrom({ light: ['c3', 'a1'], dark: ['d4', 'j10'] }) };
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('a1'), sq('b2')] }).ok).toBe(true);
    expect(manager.play(room, DARK, { kind: 'nfikh', square: sq('b2') }).ok).toBe(false);

    expect(manager.play(room, DARK, { kind: 'nfikh', square: sq('c3') }).ok).toBe(true);
    expect(room.state.board[sq('c3')]).toBe(0);
    expect(room.state.toMove).toBe(DARK); // still Black's turn: now the move
    expect(manager.play(room, DARK, { kind: 'move', path: [sq('j10'), sq('i9')] }).ok).toBe(true);
    expect(room.state.toMove).toBe(LIGHT);
  });

  it('refuses moves once the game is over', () => {
    const { manager, room } = twoPlayers();
    room.state = { ...room.state, board: boardFrom({ light: ['c3'], dark: ['d4'] }) };
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('c3'), sq('e5')] }).ok).toBe(true);
    expect(manager.play(room, DARK, { kind: 'move', path: [sq('d4'), sq('c3')] })).toEqual({ ok: false, error: 'The game is over.' });
  });

  it('lets a player back in with their token, and only with it', () => {
    const { manager, room, blackToken } = twoPlayers();
    manager.setConnected(room, DARK, false);
    expect(manager.view(room, LIGHT).opponentConnected).toBe(false);

    expect(manager.rejoin(room.code, 'not-the-token').ok).toBe(false);
    const back = manager.rejoin(room.code, blackToken);
    expect(back.ok && back.value.side).toBe(DARK);
    expect(manager.view(room, LIGHT).opponentConnected).toBe(true);
  });

  it('forgets rooms that have been empty for a while', () => {
    let time = 0;
    const manager = new RoomManager(Math.random, () => time);
    const { room } = twoPlayers(manager);
    manager.setConnected(room, LIGHT, false);
    time = 10;
    expect(manager.sweep(100)).toBe(0); // White left, but Black is still there

    manager.setConnected(room, DARK, false);
    time = 50;
    expect(manager.sweep(100)).toBe(0);
    time = 200;
    expect(manager.sweep(100)).toBe(1);
    expect(manager.get(room.code)).toBeUndefined();
  });
});
