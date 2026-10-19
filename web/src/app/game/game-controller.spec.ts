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

    expect(controller.tapSquare(parseSquare('c3'))).toBe(false);
    expect(controller.selectionInfo.selected).toBe(parseSquare('c3'));
    expect(controller.selectionInfo.candidateMoves.map((m) => m.to)).toEqual([parseSquare('g7')]);

    expect(controller.tapSquare(parseSquare('g7'))).toBe(true);
    expect(controller.state.board[parseSquare('c3')]).toBe(0);
    expect(controller.state.board[parseSquare('d4')]).toBe(0);
    expect(controller.state.board[parseSquare('f6')]).toBe(0);
    expect(controller.state.board[parseSquare('g7')]).toBe(1);
    expect(moveNotation(controller.lastMove!)).toBe('c3xe5xg7');
    expect(controller.state.toMove).toBe(-1); // turn passes to Dark
    expect(controller.selectionInfo.selected).toBeNull();
  });

  it('a tap on a square the piece cannot end on plays nothing', () => {
    const controller = controllerAt(chain);

    controller.tapSquare(parseSquare('c3'));
    // e5 is only a stop on the way, not where the move ends.
    expect(controller.tapSquare(parseSquare('e5'))).toBe(false);
    expect(controller.state.board[parseSquare('d4')]).toBe(-1); // nothing captured
    expect(controller.state.toMove).toBe(LIGHT);

    // The piece can still be picked up and played.
    controller.tapSquare(parseSquare('c3'));
    expect(controller.tapSquare(parseSquare('g7'))).toBe(true);
  });

  it('a second piece that could also capture cannot move in the same turn', () => {
    // light c3, g1; dark d4, f6, h2 -> c3 has the chain above; g1xi3 is a separate,
    // independent single-hop capture for a different piece (see rules-cases.json).
    const controller = controllerAt({ light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] });

    expect(controller.selectionInfo.compulsorySquares.sort()).toEqual(
      [parseSquare('c3'), parseSquare('g1')].sort(),
    );

    controller.tapSquare(parseSquare('g1'));
    expect(controller.tapSquare(parseSquare('i3'))).toBe(true);
    expect(controller.state.toMove).toBe(-1); // Dark's turn now

    // c3 still has an unplayed capture, but it's not Light's turn anymore — tapping it
    // must not select it or let it move. This is correct dama rules (one piece moves per
    // turn even under compulsory capture), not a bug — but it can look like the piece is
    // "stuck" if a player expects both capturing pieces to move in the same turn.
    expect(controller.tapSquare(parseSquare('c3'))).toBe(false);
    expect(controller.selectionInfo.selected).toBeNull();
    expect(controller.state.board[parseSquare('c3')]).toBe(1); // untouched
  });

  it('strict mode only allows the sequence that captures the most pieces', () => {
    const controller = controllerAt({ light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] }, true);

    // g1 has only a 1-capture option, which strict mode forbids while c3's 2-capture
    // chain is available — selecting g1 must not be allowed at all.
    expect(controller.selectionInfo.compulsorySquares).toEqual([parseSquare('c3')]);
    expect(controller.tapSquare(parseSquare('g1'))).toBe(false);
    expect(controller.selectionInfo.selected).toBeNull();
  });

  it('tapping a destination plays the move that ends there, not one passing through it', () => {
    // King j2 can go round the h4/h6/h8/f8 diamond either way: j2xg5xi7xg9xe7 or
    // j2xe7xg9xi7xg5. g5 is the first stop of one and the end of the other.
    const controller = controllerAt({ lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] });

    controller.tapSquare(parseSquare('j2'));
    expect(controller.tapSquare(parseSquare('g5'))).toBe(true);
    expect(moveNotation(controller.lastMove!)).toBe('j2xe7xg9xi7xg5');
  });

  it('asks which way to go when two capture routes end on the same square', () => {
    // Man c3 can take d4, d6, b6 and b4 going round the diamond either way, ending back on
    // c3 both times: c3xe5xc7xa5xc3 or c3xa5xc7xe5xc3.
    const controller = controllerAt({ light: ['c3'], dark: ['d4', 'b4', 'b6', 'd6'] });
    const backToC3 = controller.legalMoves.filter((m) => squareName(m.to) === 'c3');
    expect(backToC3).toHaveLength(2);

    controller.tapSquare(parseSquare('c3'));
    expect(controller.tapSquare(parseSquare('c3'))).toBe(false);
    expect(controller.selectionInfo.target).toBe(parseSquare('c3'));

    // Pick the route through a5.
    expect(controller.tapSquare(parseSquare('a5'))).toBe(true);
    expect(moveNotation(controller.lastMove!)).toBe('c3xa5xc7xe5xc3');
  });

  it('every legal move can be played: piece, destination, then the way if asked', () => {
    const positions = [
      chain,
      { light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] },
      { lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] },
      { light: ['c3'], dark: ['d4', 'b4', 'b6', 'd6'] },
    ];
    for (const pieces of positions) {
      for (const move of controllerAt(pieces).legalMoves) {
        const controller = controllerAt(pieces);
        controller.tapSquare(move.from);
        let done = controller.tapSquare(move.to);
        while (!done && controller.selectionInfo.target !== null) {
          const { path } = controller.selectionInfo;
          done = controller.tapSquare(move.path[path.length] ?? move.to);
        }
        expect(done).toBe(true);
        expect(moveNotation(controller.lastMove!)).toBe(moveNotation(move));
      }
    }
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
