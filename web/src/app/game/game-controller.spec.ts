import { boardFrom, parseSquare, squareName } from '../../engine/board';
import { moveNotation } from '../../engine/moves';
import { DARK, LIGHT } from '../../engine/types';
import { defaultSettings, GameController } from './game-controller';

/** Builds a controller, then swaps in a custom board/side-to-move for the test. */
function controllerAt(pieces: Parameters<typeof boardFrom>[0], strictMode = false) {
  const controller = new GameController({ ...defaultSettings(), mode: 'pvp', strictMode });
  controller.state = { ...controller.state, board: boardFrom(pieces), toMove: LIGHT };
  controller.resetSelection();
  return controller;
}

describe('GameController multi-jump tap sequencing', () => {
  // light c3; dark d4, f6 -> the only legal move is the chain c3xe5xg7 (see rules-cases.json).
  const chain = { light: ['c3'], dark: ['d4', 'f6'] };

  it('plays a multi-jump with two taps: the piece, then where it ends up', () => {
    const controller = controllerAt(chain);

    expect(controller.tapSquare(parseSquare('c3'))).toBe('none');
    expect(controller.selectionInfo.selected).toBe(parseSquare('c3'));
    // It could also just step to b4: capturing is optional.
    expect(controller.selectionInfo.candidateMoves.map((m) => m.to).sort()).toEqual([parseSquare('b4'), parseSquare('g7')].sort());

    expect(controller.tapSquare(parseSquare('g7'))).toBe('move');
    expect(controller.state.board[parseSquare('c3')]).toBe(0);
    expect(controller.state.board[parseSquare('d4')]).toBe(0);
    expect(controller.state.board[parseSquare('f6')]).toBe(0);
    expect(controller.state.board[parseSquare('g7')]).toBe(1);
    expect(moveNotation(controller.lastMove!)).toBe('c3xe5xg7');
    expect(controller.state.toMove).toBe(-1); // turn passes to Dark
    expect(controller.selectionInfo.selected).toBeNull();
  });

  it('a tap on a square the piece cannot end on is refused, and the piece stays selected', () => {
    const controller = controllerAt(chain);

    controller.tapSquare(parseSquare('c3'));
    // e5 is only a stop on the way, not where the move ends.
    expect(controller.tapSquare(parseSquare('e5'))).toBe('illegal');
    expect(controller.rejection).toEqual({ square: parseSquare('e5'), reason: 'unreachable' });
    expect(controller.state.board[parseSquare('d4')]).toBe(-1); // nothing captured
    expect(controller.state.toMove).toBe(LIGHT);

    // Still holding c3: the right square plays the move.
    expect(controller.selectionInfo.selected).toBe(parseSquare('c3'));
    expect(controller.tapSquare(parseSquare('g7'))).toBe('move');
    expect(controller.rejection).toBeNull();
  });

  it('a second piece that could also capture cannot move in the same turn', () => {
    // light c3, g1; dark d4, f6, h2 -> c3 has the chain above; g1xi3 is a separate,
    // independent single-hop capture for a different piece (see rules-cases.json).
    const controller = controllerAt({ light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] });

    controller.tapSquare(parseSquare('g1'));
    expect(controller.tapSquare(parseSquare('i3'))).toBe('move');
    expect(controller.state.toMove).toBe(-1); // Dark's turn now

    // c3 still has an unplayed capture, but it's not Light's turn anymore — tapping it
    // must not select it or let it move: one piece moves per turn. (Light did capture, so
    // c3 isn't open to nfikh either.)
    expect(controller.tapSquare(parseSquare('c3'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('opponent'); // a Light piece, on Dark's turn
    expect(controller.selectionInfo.selected).toBeNull();
    expect(controller.state.board[parseSquare('c3')]).toBe(1); // untouched
  });

  it('strict mode only allows the capture that takes the most pieces', () => {
    const controller = controllerAt({ light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] }, true);

    // g1's only capture takes 1 piece, which strict mode forbids while c3's 2-capture
    // chain is available. g1 can still make a plain move (captures are optional).
    controller.tapSquare(parseSquare('g1'));
    expect(controller.selectionInfo.candidateMoves.map(moveNotation)).toEqual(['g1-f2']);
    expect(controller.tapSquare(parseSquare('i3'))).toBe('illegal');
    expect(controller.state.board[parseSquare('h2')]).toBe(-1);
  });

  it('a capture is optional: a plain move can be played instead', () => {
    const controller = controllerAt(chain);
    controller.tapSquare(parseSquare('c3'));
    expect(controller.tapSquare(parseSquare('b4'))).toBe('move');
    expect(controller.state.board[parseSquare('d4')]).toBe(-1);
  });

  it('tapping a destination plays the move that ends there, not one passing through it', () => {
    // King j2 can go round the h4/h6/h8/f8 diamond either way: j2xg5xi7xg9xe7 or
    // j2xe7xg9xi7xg5. g5 is the first stop of one and the end of the other.
    const controller = controllerAt({ lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] });

    controller.tapSquare(parseSquare('j2'));
    expect(controller.tapSquare(parseSquare('g5'))).toBe('move');
    expect(moveNotation(controller.lastMove!)).toBe('j2xe7xg9xi7xg5');
  });

  it('asks which way to go when two capture routes end on the same square', () => {
    // Man c1 can reach c5 by taking d2 and d4 (c1xe3xc5) or b2 and b4 (c1xa3xc5).
    const controller = controllerAt({ light: ['c1'], dark: ['d2', 'd4', 'b2', 'b4'] });
    const toC5 = controller.legalMoves.filter((m) => squareName(m.to) === 'c5');
    expect(toC5).toHaveLength(2);

    controller.tapSquare(parseSquare('c1'));
    expect(controller.tapSquare(parseSquare('c5'))).toBe('none');
    expect(controller.selectionInfo.target).toBe(parseSquare('c5'));

    // Pick the route through a3.
    expect(controller.tapSquare(parseSquare('a3'))).toBe('move');
    expect(moveNotation(controller.lastMove!)).toBe('c1xa3xc5');
  });

  it('every legal move can be played: piece, destination, then the way if asked', () => {
    const positions = [
      chain,
      { light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] },
      { lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] },
      { light: ['c1'], dark: ['d2', 'd4', 'b2', 'b4'] },
    ];
    for (const pieces of positions) {
      for (const move of controllerAt(pieces).legalMoves) {
        const controller = controllerAt(pieces);
        controller.tapSquare(move.from);
        let done = controller.tapSquare(move.to);
        while (done === 'none' && controller.selectionInfo.target !== null) {
          const { path } = controller.selectionInfo;
          done = controller.tapSquare(move.path[path.length] ?? move.to);
        }
        expect(done).toBe('move');
        expect(moveNotation(controller.lastMove!)).toBe(moveNotation(move));
      }
    }
  });
});

describe('GameController refused taps', () => {
  // Light a9 is stuck: its only square forward, b10, holds a Dark piece it can't jump.
  const position = { light: ['c3', 'a9'], dark: ['b10', 'j10'] };

  it('says why, from what is on the tapped square only', () => {
    const controller = controllerAt(position);
    expect(controller.tapSquare(parseSquare('e5'))).toBe('illegal');
    expect(controller.rejection).toEqual({ square: parseSquare('e5'), reason: 'empty' });
    expect(controller.tapSquare(parseSquare('j10'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('opponent');
    expect(controller.tapSquare(parseSquare('a9'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('stuck');
  });

  it('picking a piece up, putting it down, or switching pieces is not refused', () => {
    const controller = controllerAt({ light: ['c3', 'e3'], dark: ['j10'] });
    expect(controller.tapSquare(parseSquare('c3'))).toBe('none');
    expect(controller.tapSquare(parseSquare('e3'))).toBe('none'); // switched
    expect(controller.selectionInfo.selected).toBe(parseSquare('e3'));
    expect(controller.tapSquare(parseSquare('e3'))).toBe('none'); // put down
    expect(controller.selectionInfo.selected).toBeNull();
    expect(controller.rejection).toBeNull();
  });

  it('while choosing the way, a square off every route is refused', () => {
    const controller = controllerAt({ light: ['c1'], dark: ['d2', 'd4', 'b2', 'b4'] });
    controller.tapSquare(parseSquare('c1'));
    controller.tapSquare(parseSquare('c5')); // two ways there: choose
    expect(controller.tapSquare(parseSquare('j10'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('route');
    expect(controller.selectionInfo.target).toBe(parseSquare('c5')); // still choosing
  });
});

describe('GameController nfikh', () => {
  // Light c3 can take d4 but plays a1-b2 instead: Dark may then take c3.
  function afterMissedCapture() {
    const controller = controllerAt({ light: ['c3', 'a1'], dark: ['d4', 'j10'] });
    controller.tapSquare(parseSquare('a1'));
    controller.tapSquare(parseSquare('b2'));
    return controller;
  }

  it('tapping the piece that missed a capture takes it, and the taker then moves', () => {
    const controller = afterMissedCapture();
    expect(controller.state.toMove).toBe(DARK);

    expect(controller.tapSquare(parseSquare('c3'))).toBe('nfikh');
    expect(controller.state.board[parseSquare('c3')]).toBe(0);
    expect(controller.state.toMove).toBe(DARK);
    expect(controller.lastNfikh).toEqual({ square: parseSquare('c3'), by: DARK });

    controller.tapSquare(parseSquare('j10'));
    expect(controller.tapSquare(parseSquare('i9'))).toBe('move');
    expect(controller.state.toMove).toBe(LIGHT);
    expect(controller.lastNfikh).not.toBeNull(); // still news for Light

    controller.tapSquare(parseSquare('b2'));
    controller.tapSquare(parseSquare('c3'));
    expect(controller.lastNfikh).toBeNull();
  });

  it('only one piece can be taken, and only before moving', () => {
    const controller = controllerAt({ light: ['c3', 'g3', 'a1'], dark: ['d4', 'h4', 'j10'] });
    controller.tapSquare(parseSquare('a1'));
    controller.tapSquare(parseSquare('b2'));

    expect(controller.tapSquare(parseSquare('c3'))).toBe('nfikh');
    expect(controller.tapSquare(parseSquare('g3'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('opponent'); // only one piece per turn
    expect(controller.state.board[parseSquare('g3')]).toBe(1);
  });

  it('the chance is lost once the opponent moves instead', () => {
    const controller = afterMissedCapture();
    controller.tapSquare(parseSquare('j10'));
    expect(controller.tapSquare(parseSquare('i9'))).toBe('move');
    expect(controller.state.forfeitable).toEqual([]);
    expect(controller.state.board[parseSquare('c3')]).toBe(1);
  });

  it('a piece that did not miss a capture cannot be taken', () => {
    const controller = afterMissedCapture();
    expect(controller.tapSquare(parseSquare('b2'))).toBe('illegal');
    expect(controller.rejection?.reason).toBe('opponent');
    expect(controller.state.board[parseSquare('b2')]).toBe(1);
  });
});

describe('GameController undo (vs computer)', () => {
  function vsComputer(playerSide: typeof LIGHT | typeof DARK) {
    return new GameController({ ...defaultSettings(), mode: 'computer', playerSide });
  }
  // Which move doesn't matter here, only whose turn it is.
  const playAny = (c: GameController) => c.applyExternalMove(c.legalMoves[0]);
  const play = (c: GameController, from: string, to: string) => {
    const move = c.legalMoves.find((m) => squareName(m.from) === from && squareName(m.to) === to);
    if (!move) throw new Error(`no move ${from}-${to}`);
    c.applyExternalMove(move);
  };

  it('takes back the player move and the computer reply to it', () => {
    const c = vsComputer(LIGHT);
    playAny(c); // player
    playAny(c); // computer
    const beforeSecond = c.state;
    playAny(c); // player
    playAny(c); // computer

    expect(c.canUndo()).toBe(true);
    c.undo();
    expect(c.state).toBe(beforeSecond);
    expect(c.state.toMove).toBe(LIGHT);
  });

  it('before the computer has replied, only takes back the player move', () => {
    const c = vsComputer(LIGHT);
    playAny(c); // player
    playAny(c); // computer
    const beforeSecond = c.state;
    playAny(c); // player; the computer hasn't answered yet

    c.undo();
    expect(c.state).toBe(beforeSecond); // the computer's earlier reply is still on the board
    expect(c.state.toMove).toBe(LIGHT);
  });

  it("never undoes the computer's opening when the player is Dark", () => {
    const c = vsComputer(DARK);
    playAny(c); // computer opens as Light
    const afterOpening = c.state;

    expect(c.canUndo()).toBe(false);
    c.undo();
    expect(c.state).toBe(afterOpening);
    expect(c.state.toMove).toBe(DARK);
  });

  it('takes back a winning move', () => {
    const c = vsComputer(LIGHT);
    c.state = { ...c.state, board: boardFrom({ light: ['c3'], dark: ['d4'] }) };
    const before = c.state;
    play(c, 'c3', 'e5');
    expect(c.outcome.kind).toBe('win');

    c.undo();
    expect(c.state).toBe(before);
    expect(c.outcome.kind).toBe('ongoing');
  });

  it('is not available in 1v1', () => {
    const c = new GameController({ ...defaultSettings(), mode: 'pvp' });
    playAny(c);
    playAny(c);
    expect(c.canUndo()).toBe(false);
    const state = c.state;
    c.undo();
    expect(c.state).toBe(state);
  });
});

describe('GameController move list and the move timer', () => {
  const start = () => new GameController({ ...defaultSettings(), mode: 'pvp' });
  const tap = (controller: GameController, ...squares: string[]) => squares.forEach((s) => controller.tapSquare(parseSquare(s)));

  it('lists every turn: who played, and the move', () => {
    const controller = start();
    tap(controller, 'b4', 'a5', 'c7', 'b6');
    expect(controller.plies.map((p) => [p.side, p.nfikh, p.move && moveNotation(p.move)])).toEqual([
      [LIGHT, null, 'b4-a5'],
      [DARK, null, 'c7-b6'],
    ]);
  });

  it('a skipped turn goes in the list with no move, and the other side moves', () => {
    const controller = start();
    tap(controller, 'b4'); // picked up, then the time runs out
    controller.passTurn();
    expect(controller.state.toMove).toBe(DARK);
    expect(controller.selectionInfo.selected).toBeNull();
    expect(controller.lastTimeout).toBe(LIGHT);
    expect(controller.plies).toEqual([{ side: LIGHT, nfikh: null, move: null }]);
    tap(controller, 'c7', 'b6');
    expect(controller.lastTimeout).toBeNull(); // old news once a move is played
  });

  it('an nfikh goes with the move that follows it', () => {
    // White skips a capture (b4 could take c5), so Black may take b4 by nfikh.
    const controller = controllerAt({ light: ['b4', 'g3'], dark: ['c5', 'h8'] });
    tap(controller, 'g3', 'h4', 'b4', 'h8', 'g7');
    expect(controller.plies.map((p) => [p.nfikh === null ? null : squareName(p.nfikh), p.move && moveNotation(p.move)])).toEqual([
      [null, 'g3-h4'],
      ['b4', 'h8-g7'],
    ]);
  });

  it('Undo takes the moves back out of the list', () => {
    const controller = new GameController({ ...defaultSettings(), mode: 'computer', playerSide: LIGHT });
    tap(controller, 'b4', 'a5');
    controller.applyExternalMove(controller.legalMoves.find((m) => moveNotation(m) === 'c7-b6')!);
    controller.undo();
    expect(controller.plies).toEqual([]);
  });

  it("rebuilds the list from the server's actions", () => {
    const controller = start();
    const reference = start();
    tap(reference, 'b4', 'a5');
    reference.passTurn();
    controller.loadHistory(
      [
        { kind: 'move', path: [parseSquare('b4'), parseSquare('a5')], by: LIGHT },
        { kind: 'timeout', by: DARK },
      ],
      reference.state,
    );
    expect(controller.plies.map((p) => [p.side, p.move && moveNotation(p.move)])).toEqual([
      [LIGHT, 'b4-a5'],
      [DARK, null],
    ]);
    expect(controller.lastTimeout).toBe(DARK);
    expect(controller.state).toBe(reference.state);
  });

  it("falls back to the server's position alone if its actions can't be followed", () => {
    const controller = start();
    const state = start().state;
    controller.loadHistory([{ kind: 'move', path: [parseSquare('b4'), parseSquare('b5')], by: LIGHT }], state);
    expect(controller.plies).toEqual([]);
    expect(controller.state).toBe(state);
  });
});
