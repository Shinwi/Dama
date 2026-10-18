import { boardFrom, parseSquare } from '../../engine/board';
import { moveNotation, sortedNotations } from '../../engine/moves';
import { LIGHT } from '../../engine/types';
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

  it('completes a two-hop capture by tapping each landing square in turn', () => {
    const controller = controllerAt(chain);

    expect(controller.tapSquare(parseSquare('c3'))).toBe(false);
    expect(controller.selectionInfo.selected).toBe(parseSquare('c3'));
    expect(controller.selectionInfo.path).toEqual([parseSquare('c3')]);

    // First hop: lands on e5, but must keep jumping — not a complete move yet.
    expect(controller.tapSquare(parseSquare('e5'))).toBe(false);
    expect(controller.selectionInfo.path).toEqual([parseSquare('c3'), parseSquare('e5')]);
    expect(controller.selectionInfo.candidateMoves).toHaveLength(1);

    // Second hop: lands on g7, completing the move.
    expect(controller.tapSquare(parseSquare('g7'))).toBe(true);
    expect(controller.state.board[parseSquare('c3')]).toBe(0);
    expect(controller.state.board[parseSquare('d4')]).toBe(0);
    expect(controller.state.board[parseSquare('f6')]).toBe(0);
    expect(controller.state.board[parseSquare('g7')]).toBe(1);
    expect(controller.state.toMove).toBe(-1); // turn passes to Dark
    expect(controller.selectionInfo.selected).toBeNull();
  });

  it('also completes a two-hop capture by tapping straight to the final square', () => {
    const controller = controllerAt(chain);

    controller.tapSquare(parseSquare('c3'));
    expect(controller.tapSquare(parseSquare('g7'))).toBe(true);

    expect(controller.state.board[parseSquare('g7')]).toBe(1);
    expect(controller.state.board[parseSquare('d4')]).toBe(0);
    expect(controller.state.board[parseSquare('f6')]).toBe(0);
  });

  it('does not abandon a forced continuation on a mistaken tap mid-sequence', () => {
    const controller = controllerAt(chain);

    controller.tapSquare(parseSquare('c3'));
    controller.tapSquare(parseSquare('e5'));
    const beforeMistap = controller.selectionInfo;

    // Tap something irrelevant — this must not complete the move, reset the selection, or
    // silently let the piece stop short of the forced second hop.
    expect(controller.tapSquare(parseSquare('a1'))).toBe(false);
    expect(controller.selectionInfo).toEqual(beforeMistap);
    expect(controller.state.board[parseSquare('d4')]).toBe(-1); // nothing captured yet

    // The real continuation still works after the mistake.
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

  it('plays the path tapped hop by hop, even when that hop is where another sequence ends', () => {
    // King j2 can go round the h4/h6/h8/f8 diamond either way: j2xg5xi7xg9xe7 or
    // j2xe7xg9xi7xg5. g5 is the first hop of one and the final square of the other.
    const controller = controllerAt({ lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] });
    expect(sortedNotations(controller.legalMoves)).toContain('j2xe7xg9xi7xg5');

    controller.tapSquare(parseSquare('j2'));
    // Tapping g5 is the first hop of j2xg5x…, not a shortcut to the end of j2xe7x…xg5.
    expect(controller.tapSquare(parseSquare('g5'))).toBe(false);
    expect(controller.selectionInfo.path).toEqual([parseSquare('j2'), parseSquare('g5')]);

    for (const square of ['i7', 'g9']) {
      expect(controller.tapSquare(parseSquare(square))).toBe(false);
    }
    expect(controller.tapSquare(parseSquare('e7'))).toBe(true);
    expect(moveNotation(controller.lastMove!)).toBe('j2xg5xi7xg9xe7');
  });

  it('every legal move can be played by tapping its path square by square', () => {
    const positions = [
      chain,
      { light: ['c3', 'g1'], dark: ['d4', 'f6', 'h2'] },
      { lightKings: ['j2'], dark: ['h4', 'h6', 'h8', 'f8'] },
    ];
    for (const pieces of positions) {
      for (const move of controllerAt(pieces).legalMoves) {
        const controller = controllerAt(pieces);
        const results = move.path.map((square) => controller.tapSquare(square));
        expect(results).toEqual([...move.path.slice(1).map(() => false), true]);
        expect(moveNotation(controller.lastMove!)).toBe(moveNotation(move));
      }
    }
  });
});
