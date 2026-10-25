import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare } from '../../engine/board';
import { advanceState, createInitialState, legalMoves, passTurn, takeForfeit } from '../../engine/game';
import { DARK, GameState, LIGHT, Side } from '../../engine/types';
import { ActionReply, JoinedReply, OnlineAction, RoomView } from '../../protocol/online';
import { GameService } from './game.service';

const sq = parseSquare;

/** Stands in for OnlineClient: records what the game sends, and replies as told. */
class FakeOnlineClient {
  readonly sent: { code: string; token: string; action: OnlineAction }[] = [];
  rejoins = 0;
  closed = false;
  onUpdate: (view: RoomView) => void = () => {};
  onConnection: (state: 'connected' | 'reconnecting', reconnected: boolean) => void = () => {};
  joinedReply: JoinedReply = { ok: false, error: 'not set up' };
  actionReply: ActionReply | { ok: false; error: string; unreachable: true } = { ok: true };
  /** When set, rejoin waits for the test to answer it. */
  pendingRejoin: ((reply: JoinedReply) => void) | null = null;
  holdRejoins = false;

  create = async () => this.joinedReply;
  join = async () => this.joinedReply;
  requests: string[] = [];
  requestReply: ActionReply = { ok: true };
  private record = (name: string) => async () => {
    this.requests.push(name);
    return this.requestReply;
  };
  resign = this.record('resign');
  offerDraw = this.record('offerDraw');
  claimWin = this.record('claimWin');
  answerDraw = async (_code: string, _token: string, accept: boolean) => this.record(`answerDraw:${accept}`)();
  rematch = async (_code: string, _token: string, yes: boolean) => this.record(`rematch:${yes}`)();
  rejoin = () => {
    this.rejoins++;
    if (!this.holdRejoins) return Promise.resolve(this.joinedReply);
    return new Promise<JoinedReply>((resolve) => (this.pendingRejoin = resolve));
  };
  act = async (code: string, token: string, action: OnlineAction) => {
    this.sent.push({ code, token, action });
    return this.actionReply;
  };
  close = () => {
    this.closed = true;
  };
}

function view(state: GameState, side: Side, seq: number, extra: Partial<RoomView> = {}): RoomView {
  return {
    code: 'K7QX',
    yourSide: side,
    opponentJoined: true,
    opponentConnected: true,
    state: { ...state, board: Array.from(state.board) },
    seq,
    lastAction: null,
    actions: [],
    moveTimeMs: 0,
    turnLeftMs: null,
    game: 0,
    result: null,
    drawOffer: null,
    rematch: { you: false, opponent: false },
    opponentGoneForMs: null,
    claimWinAfterMs: 300_000,
    ...extra,
  };
}

function play(state: GameState, from: string, to: string): GameState {
  const move = legalMoves(state).find((m) => m.from === sq(from) && m.to === sq(to))!;
  return advanceState(state, move);
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('GameService online', () => {
  let service: GameService;
  let client: FakeOnlineClient;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(GameService);
    client = new FakeOnlineClient();
    (service as unknown as { onlineClientFactory: () => unknown }).onlineClientFactory = () => client;
  });

  async function enterRoom(side: Side, opponentJoined: boolean): Promise<void> {
    client.joinedReply = { ok: true, token: 'secret', view: view(createInitialState(), side, 0, { opponentJoined }) };
    expect(await service.startOnline({ kind: 'create' })).toBeNull();
  }

  it('waits for the friend to join before anyone can move', async () => {
    await enterRoom(LIGHT, false);
    expect(service.online()?.code).toBe('K7QX');
    expect(service.settings().mode).toBe('online');
    expect(service.isHumanTurn()).toBe(false);

    client.onUpdate(view(createInitialState(), LIGHT, 0));
    expect(service.online()?.opponentJoined).toBe(true);
    expect(service.isHumanTurn()).toBe(true);
  });

  const storedSeats = () => JSON.parse(localStorage.getItem('dama.online.seats.v1') ?? 'null');

  it('keeps the seat in localStorage, so closing Safari does not lose it (issue #39)', async () => {
    await enterRoom(LIGHT, true);
    expect(storedSeats()).toMatchObject({ current: 'K7QX', seats: { K7QX: { token: 'secret' } } });

    // Leaving on purpose: no jumping back in on the next visit, but the seat is kept for its code.
    service.leaveOnline();
    expect(client.closed).toBe(true);
    expect(storedSeats()).toMatchObject({ current: null, seats: { K7QX: { token: 'secret' } } });
  });

  it('goes back into the game when the site is opened again', async () => {
    await enterRoom(LIGHT, true);
    // A new page: a fresh service, with only what's in localStorage.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const reopened = TestBed.inject(GameService);
    const newClient = new FakeOnlineClient();
    (reopened as unknown as { onlineClientFactory: () => unknown }).onlineClientFactory = () => newClient;
    newClient.joinedReply = { ok: true, token: 'secret', view: view(createInitialState(), LIGHT, 0) };

    expect(await reopened.resumeOnline()).toBe(true);
    expect(newClient.rejoins).toBe(1);
    expect(reopened.online()?.code).toBe('K7QX');
  });

  it('forgets the seat when the room is gone on reopening', async () => {
    await enterRoom(LIGHT, true);
    client.joinedReply = { ok: false, error: 'That game is no longer available.' };
    expect(await service.resumeOnline()).toBe(false);
    expect(storedSeats()).toBeNull();
  });

  it('joining a room you have a seat in takes the seat back, instead of "room is full"', async () => {
    await enterRoom(LIGHT, true);
    service.leaveOnline();
    let joins = 0;
    client = new FakeOnlineClient();
    client.join = async () => {
      joins++;
      return { ok: false, error: 'That room already has two players.' };
    };
    client.joinedReply = { ok: true, token: 'secret', view: view(createInitialState(), LIGHT, 0) };
    (service as unknown as { onlineClientFactory: () => unknown }).onlineClientFactory = () => client;

    expect(await service.startOnline({ kind: 'join', code: 'k7qx' })).toBeNull();
    expect(client.rejoins).toBe(1);
    expect(joins).toBe(0);
    expect(service.online()?.side).toBe(LIGHT);
  });

  it('notes when the opponent lost their connection, and forgets it when they are back', async () => {
    await enterRoom(LIGHT, true);
    (service as unknown as { now: () => number }).now = () => 1000;
    client.onUpdate(view(createInitialState(), LIGHT, 0, { opponentConnected: false }));
    expect(service.online()?.opponentGoneSince).toBe(1000);

    (service as unknown as { now: () => number }).now = () => 5000;
    client.onUpdate(view(createInitialState(), LIGHT, 0, { opponentConnected: false }));
    expect(service.online()?.opponentGoneSince).toBe(1000); // still since the first time

    client.onUpdate(view(createInitialState(), LIGHT, 0));
    expect(service.online()?.opponentGoneSince).toBeNull();
  });

  it("plays the player's own move at once and sends it to the server", async () => {
    await enterRoom(LIGHT, true);
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    expect(service.state().board[sq('a5')]).toBe(1);
    expect(client.sent).toEqual([{ code: 'K7QX', token: 'secret', action: { kind: 'move', path: [sq('b4'), sq('a5')] } }]);

    // The server's echo of the same move changes nothing: the slide isn't cut short.
    const after = play(createInitialState(), 'b4', 'a5');
    client.onUpdate(view(after, LIGHT, 1, { lastAction: { kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT } }));
    expect(service.updateKind()).toBe('move');
    expect(service.isHumanTurn()).toBe(false); // Black's turn now
  });

  it("plays the opponent's move as it arrives, animated", async () => {
    await enterRoom(DARK, true);
    expect(service.playerSide()).toBe(DARK);
    expect(service.isHumanTurn()).toBe(false); // White opens

    const after = play(createInitialState(), 'b4', 'a5');
    client.onUpdate(view(after, DARK, 1, { lastAction: { kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT } }));
    expect(service.updateKind()).toBe('move');
    expect(service.lastMove()?.path).toEqual([sq('b4'), sq('a5')]);
    TestBed.tick();
    expect(service.announcement()).toBe('Opponent played b4 to a5.');
    service.boardSettled();
    expect(service.isHumanTurn()).toBe(true);
  });

  it("shows the opponent's nfikh, then their move", async () => {
    await enterRoom(LIGHT, true);
    // Get to a position where White skipped a capture: c3 could take d4.
    const start = { ...createInitialState(), board: boardFrom({ light: ['c3', 'a1'], dark: ['d4', 'j10'] }) };
    client.onUpdate(view(start, LIGHT, 0));
    service.tapSquare(sq('a1'));
    service.tapSquare(sq('b2'));
    service.boardSettled();
    const missed = play(start, 'a1', 'b2');
    client.onUpdate(view(missed, LIGHT, 1, { lastAction: { kind: 'move', path: [sq('a1'), sq('b2')], by: LIGHT } }));

    const taken = takeForfeit(missed, sq('c3'));
    client.onUpdate(view(taken, LIGHT, 2, { lastAction: { kind: 'nfikh', square: sq('c3'), by: DARK } }));
    expect(service.updateKind()).toBe('nfikh');
    expect(service.lastNfikh()).toEqual({ square: sq('c3'), by: DARK });
    expect(service.state().board[sq('c3')]).toBe(0);
  });

  it("snaps to the server's position when an update was missed", async () => {
    await enterRoom(LIGHT, true);
    const twoMovesLater = play(play(createInitialState(), 'b4', 'a5'), 'c7', 'd6');
    client.onUpdate(view(twoMovesLater, LIGHT, 2, { lastAction: { kind: 'move', path: [sq('c7'), sq('d6')], by: DARK } }));
    expect(service.updateKind()).toBe('reset');
    expect(Array.from(service.state().board)).toEqual(Array.from(twoMovesLater.board));
    expect(service.isHumanTurn()).toBe(true);
  });

  it('takes a refused move back, and says why', async () => {
    await enterRoom(LIGHT, true);
    client.actionReply = { ok: false, error: 'Illegal move.', view: view(createInitialState(), LIGHT, 0) };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    expect(service.online()?.error).toBe('Illegal move.');
    expect(service.state().board[sq('b4')]).toBe(1);
    expect(service.state().board[sq('a5')]).toBe(0);
  });

  it('passes on why a room could not be joined', async () => {
    client.joinedReply = { ok: false, error: 'No room with that code.' };
    expect(await service.startOnline({ kind: 'join', code: 'ZZZZ' })).toBe('No room with that code.');
    expect(service.online()).toBeNull();
  });

  it('blocks moves while the connection is down, until the server has the player back in their seat', async () => {
    await enterRoom(LIGHT, true);
    client.onConnection('reconnecting', false);
    expect(service.isHumanTurn()).toBe(false);

    client.holdRejoins = true;
    client.onConnection('connected', true);
    expect(client.rejoins).toBe(1);
    expect(service.online()?.connection).toBe('reconnecting'); // connected, but not seated yet
    expect(service.isHumanTurn()).toBe(false);

    client.pendingRejoin!({ ok: true, token: 'secret', view: view(createInitialState(), LIGHT, 0) });
    await flush();
    expect(service.online()?.connection).toBe('connected');
    expect(service.isHumanTurn()).toBe(true);
  });

  it('says so when the server no longer has the game after a reconnect', async () => {
    await enterRoom(LIGHT, true);
    client.onConnection('reconnecting', false);
    client.joinedReply = { ok: false, error: 'That game is no longer available.' };
    client.onConnection('connected', true);
    await flush();
    expect(service.online()).toMatchObject({ connection: 'lost', error: 'That game is no longer available.' });
    expect(service.isHumanTurn()).toBe(false);
  });

  it('does not call an unanswered move a refusal (the connection dropped)', async () => {
    await enterRoom(LIGHT, true);
    client.actionReply = { ok: false, error: "Can't reach the online server. Is it running?", unreachable: true };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    expect(service.online()?.error).toBeNull();
    expect(service.state().board[sq('a5')]).toBe(1); // still shown; the rejoin will confirm it
  });

  it('clears an old error once the game moves on', async () => {
    await enterRoom(LIGHT, true);
    client.actionReply = { ok: false, error: 'Illegal move.', view: view(createInitialState(), LIGHT, 0) };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    expect(service.online()?.error).toBe('Illegal move.');

    client.actionReply = { ok: true };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    expect(service.online()?.error).toBeNull();
  });

  it('starting an offline game leaves the room', async () => {
    await enterRoom(LIGHT, true);
    service.newGame({ mode: 'computer' });
    expect(service.online()).toBeNull();
    expect(client.closed).toBe(true);
  });

  it('keeps only the latest answer about whether the server is there', async () => {
    const answers: ((up: boolean) => void)[] = [];
    (service as unknown as { onlineServerProbe: () => Promise<boolean> }).onlineServerProbe = () =>
      new Promise((resolve) => answers.push(resolve));
    expect(service.onlineServer()).toBe('checking');

    const first = service.checkOnlineServer();
    const second = service.checkOnlineServer();
    answers[1](true);
    await second;
    answers[0](false); // an older, slower check: ignored
    await first;
    expect(service.onlineServer()).toBe('up');
  });

  it('sends a move again after a reconnect if the server never got it', async () => {
    await enterRoom(LIGHT, true);
    client.actionReply = { ok: false, error: "Can't reach the online server. Is it running?", unreachable: true };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    service.boardSettled();
    client.onConnection('reconnecting', false);

    // Back: the server is still at seq 0, without the move.
    client.actionReply = { ok: true };
    client.joinedReply = { ok: true, token: 'secret', view: view(createInitialState(), LIGHT, 0) };
    client.onConnection('connected', true);
    await flush();

    expect(client.sent.map((s) => s.action)).toEqual([
      { kind: 'move', path: [sq('b4'), sq('a5')] },
      { kind: 'move', path: [sq('b4'), sq('a5')] },
    ]);
    expect(service.state().board[sq('a5')]).toBe(1); // never jumped back
    expect(service.online()?.connection).toBe('connected');

    // The server's update for the re-sent move is in step: nothing snaps.
    const after = play(createInitialState(), 'b4', 'a5');
    client.onUpdate(view(after, LIGHT, 1, { lastAction: { kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT } }));
    expect(service.updateKind()).not.toBe('reset');
  });

  it('does not send a move twice if the server got it before the drop', async () => {
    await enterRoom(LIGHT, true);
    client.actionReply = { ok: false, error: "Can't reach the online server. Is it running?", unreachable: true };
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    await flush();
    client.onConnection('reconnecting', false);

    const after = play(createInitialState(), 'b4', 'a5');
    client.joinedReply = {
      ok: true,
      token: 'secret',
      view: view(after, LIGHT, 1, { lastAction: { kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT } }),
    };
    client.onConnection('connected', true);
    await flush();
    expect(client.sent).toHaveLength(1);
    expect(service.updateKind()).not.toBe('reset');
  });

  it("the server's result ends the game, and no more moves can be made", async () => {
    await enterRoom(LIGHT, true);
    client.onUpdate(view(createInitialState(), LIGHT, 0, { result: { kind: 'resigned', winner: DARK } }));
    expect(service.outcome()).toEqual({ kind: 'win', winner: DARK });
    expect(service.endReason()).toBe('resigned');
    expect(service.isHumanTurn()).toBe(false);
  });

  it('sends resign, draw, claim-win and rematch requests for this seat, and shows a refusal', async () => {
    await enterRoom(LIGHT, true);
    service.resign();
    service.offerDraw();
    service.answerDraw(false);
    service.claimWin();
    service.askRematch(true);
    await flush();
    expect(client.requests).toEqual(['resign', 'offerDraw', 'answerDraw:false', 'claimWin', 'rematch:true']);

    client.requestReply = { ok: false, error: 'Your opponent may still come back.' };
    service.claimWin();
    await flush();
    expect(service.online()?.error).toBe('Your opponent may still come back.');
  });

  it('works out when the win can be claimed, from how long the server says the opponent has been gone', async () => {
    await enterRoom(LIGHT, true);
    (service as unknown as { now: () => number }).now = () => 10_000;
    client.onUpdate(view(createInitialState(), LIGHT, 0, { opponentConnected: false, opponentGoneForMs: 60_000, claimWinAfterMs: 300_000 }));
    expect(service.online()?.claimWinAt).toBe(10_000 + 240_000);
    expect(service.online()?.opponentGoneSince).toBe(10_000 - 60_000);

    client.onUpdate(view(createInitialState(), LIGHT, 0));
    expect(service.online()?.claimWinAt).toBeNull();
  });

  it('a rematch starts the next game with the colour the server gives, on a fresh board', async () => {
    await enterRoom(LIGHT, true);
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    service.boardSettled();
    const after = play(createInitialState(), 'b4', 'a5');
    client.onUpdate(view(after, LIGHT, 1, { result: { kind: 'resigned', winner: LIGHT } }));

    client.onUpdate(view(createInitialState(), DARK, 0, { game: 1 }));
    expect(service.online()).toMatchObject({ game: 1, side: DARK, result: null });
    expect(service.playerSide()).toBe(DARK);
    expect(service.outcome().kind).toBe('ongoing');
    expect(service.updateKind()).toBe('reset');
    expect(Array.from(service.state().board)).toEqual(Array.from(createInitialState().board));
    expect(service.isHumanTurn()).toBe(false); // White (the opponent now) opens
  });

  it("runs the server's clock: the turn's time left, as it sent it", async () => {
    (service as unknown as { now: () => number }).now = () => 50_000;
    await enterRoom(LIGHT, true);
    client.onUpdate(view(createInitialState(), LIGHT, 0, { moveTimeMs: 30_000, turnLeftMs: 21_000 }));
    expect(service.moveTimeMs()).toBe(30_000);
    expect(service.turnClock()).toEqual({ side: LIGHT, deadline: 71_000, totalMs: 30_000 });
    // The clock never skips a turn itself online: the server does, and says so.
    (service as unknown as { now: () => number }).now = () => 200_000;
    (service as unknown as { clockTick: () => void }).clockTick();
    expect(service.state().toMove).toBe(LIGHT);
    service.leaveOnline();
    expect(service.turnClock()).toBeNull();
  });

  it('skips the turn when the server says the time ran out', async () => {
    await enterRoom(LIGHT, true);
    service.tapSquare(sq('b4')); // picked up, but too late
    const skipped = passTurn(createInitialState());
    client.onUpdate(view(skipped, LIGHT, 1, { lastAction: { kind: 'timeout', by: LIGHT }, actions: [{ kind: 'timeout', by: LIGHT }] }));
    expect(service.state().toMove).toBe(DARK);
    expect(service.lastTimeout()).toBe(LIGHT);
    expect(service.selection().selected).toBeNull();
    expect(service.plies()).toEqual([{ side: LIGHT, nfikh: null, move: null }]);
    expect(service.updateKind()).toBe('reset');
  });

  it('rebuilds the move list from the server when it snaps to its position', async () => {
    const after = play(createInitialState(), 'b4', 'a5');
    client.joinedReply = {
      ok: true,
      token: 'secret',
      view: view(after, DARK, 1, { lastAction: { kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT }, actions: [{ kind: 'move', path: [sq('b4'), sq('a5')], by: LIGHT }] }),
    };
    expect(await service.startOnline({ kind: 'create' })).toBeNull();
    expect(service.plies()).toHaveLength(1);
    expect(service.plies()[0]).toMatchObject({ side: LIGHT, nfikh: null });
    expect(service.lastMove()?.to).toBe(sq('a5'));
  });

  it('sends the move timer when it creates a room', async () => {
    let asked: unknown[] = [];
    client.create = async (...args: unknown[]) => {
      asked = args;
      return client.joinedReply;
    };
    client.joinedReply = { ok: true, token: 'secret', view: view(createInitialState(), LIGHT, 0, { opponentJoined: false }) };
    await service.startOnline({ kind: 'create' }, { moveTime: 45 });
    expect(asked).toEqual([LIGHT, false, 45]);
  });
});
