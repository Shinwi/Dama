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

describe('ending a game other than on the board', () => {
  it('resigning ends the game: the opponent wins, and moves are refused', () => {
    const { manager, room } = twoPlayers();
    const resigned = manager.resign(room, LIGHT);
    expect(resigned.ok && resigned.value.result).toBe('resigned');
    expect(manager.view(room, DARK).result).toEqual({ kind: 'resigned', winner: DARK });
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('a5')] })).toEqual({ ok: false, error: 'The game is over.' });
    expect(manager.resign(room, DARK).ok).toBe(false);
    expect(manager.counts().active).toBe(0);
  });

  it('a draw offer is shown to both, and accepting it ends the game as a draw', () => {
    const { manager, room } = twoPlayers();
    expect(manager.offerDraw(room, LIGHT).ok).toBe(true);
    expect(manager.view(room, LIGHT).drawOffer).toBe('you');
    expect(manager.view(room, DARK).drawOffer).toBe('opponent');
    expect(manager.offerDraw(room, LIGHT)).toEqual({ ok: false, error: 'You have already offered a draw.' });
    expect(manager.answerDraw(room, LIGHT, true).ok).toBe(false); // can't answer your own offer

    const answered = manager.answerDraw(room, DARK, true);
    expect(answered.ok && answered.value.finished?.result).toBe('draw_agreed');
    expect(manager.view(room, DARK)).toMatchObject({ result: { kind: 'draw_agreed', winner: null }, drawOffer: null });
  });

  it('a declined offer, or one answered with a move, goes away', () => {
    const { manager, room } = twoPlayers();
    manager.offerDraw(room, LIGHT);
    expect(manager.answerDraw(room, DARK, false)).toEqual({ ok: true, value: { finished: null } });
    expect(manager.view(room, LIGHT).drawOffer).toBeNull();

    // Offered on your own turn: it stands while you move, and lapses when the opponent moves.
    manager.offerDraw(room, LIGHT);
    manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('a5')] });
    expect(manager.view(room, DARK).drawOffer).toBe('opponent');
    manager.play(room, DARK, { kind: 'move', path: [sq('c7'), sq('d6')] });
    expect(manager.view(room, DARK).drawOffer).toBeNull();
  });

  it('offering a draw when the opponent already offered one accepts it', () => {
    const { manager, room } = twoPlayers();
    manager.offerDraw(room, LIGHT);
    const both = manager.offerDraw(room, DARK);
    expect(both.ok && both.value.finished?.result).toBe('draw_agreed');
  });

  it('a win can be claimed only once the opponent has been gone long enough', () => {
    let time = 0;
    const manager = new RoomManager(Math.random, () => time, 5 * 60_000);
    const { room } = twoPlayers(manager);
    expect(manager.claimWin(room, LIGHT)).toEqual({ ok: false, error: 'Your opponent is here.' });

    manager.setConnected(room, DARK, false);
    time = 4 * 60_000;
    expect(manager.view(room, LIGHT)).toMatchObject({ opponentGoneForMs: 4 * 60_000, claimWinAfterMs: 5 * 60_000 });
    expect(manager.claimWin(room, LIGHT)).toEqual({ ok: false, error: 'Your opponent may still come back.' });

    time = 5 * 60_000;
    const claimed = manager.claimWin(room, LIGHT);
    expect(claimed.ok && claimed.value.result).toBe('abandoned');
    expect(manager.view(room, DARK).result).toEqual({ kind: 'abandoned', winner: LIGHT });
  });

  it('coming back resets the clock for claiming the win', () => {
    let time = 0;
    const manager = new RoomManager(Math.random, () => time, 60_000);
    const { room } = twoPlayers(manager);
    manager.setConnected(room, DARK, false);
    time = 50_000;
    manager.setConnected(room, DARK, true);
    manager.setConnected(room, DARK, false);
    time = 100_000;
    expect(manager.claimWin(room, LIGHT).ok).toBe(false); // gone 50 s this time, not 100
  });
});

describe('rematch', () => {
  function finishedGame() {
    const setUp = twoPlayers();
    setUp.manager.resign(setUp.room, LIGHT);
    return setUp;
  }

  it('needs the game to be over', () => {
    const { manager, room } = twoPlayers();
    expect(manager.rematch(room, LIGHT, true)).toEqual({ ok: false, error: 'The game is still on.' });
  });

  it('starts the next game once both have asked: same rules, colours swapped, fresh board', () => {
    const { manager, room, whiteToken, blackToken } = finishedGame();
    expect(manager.rematch(room, LIGHT, true)).toEqual({ ok: true, value: { started: false } });
    expect(manager.view(room, DARK).rematch).toEqual({ you: false, opponent: true });

    expect(manager.rematch(room, DARK, true)).toEqual({ ok: true, value: { started: true } });
    expect(manager.sideOf(room, whiteToken)).toBe(DARK); // the first game's White now plays Black
    expect(manager.sideOf(room, blackToken)).toBe(LIGHT);
    const view = manager.view(room, LIGHT);
    expect(view).toMatchObject({ game: 1, seq: 0, result: null, lastAction: null, rematch: { you: false, opponent: false } });
    expect(view.state.toMove).toBe(LIGHT);
    expect(manager.counts().active).toBe(1);
    // The new White (the old Black) moves first.
    expect(manager.play(room, LIGHT, { kind: 'move', path: [sq('b4'), sq('a5')] }).ok).toBe(true);
  });

  it('"No thanks" (or taking a request back) clears both requests', () => {
    const { manager, room } = finishedGame();
    manager.rematch(room, LIGHT, true);
    manager.rematch(room, DARK, false);
    expect(manager.view(room, LIGHT).rematch).toEqual({ you: false, opponent: false });
  });

  it('keeps strict mode for the next game', () => {
    const manager = new RoomManager();
    const { room } = manager.create(LIGHT, true);
    manager.join(room.code);
    manager.resign(room, DARK);
    manager.rematch(room, LIGHT, true);
    manager.rematch(room, DARK, true);
    expect(room.state.strictMode).toBe(true);
  });
});
