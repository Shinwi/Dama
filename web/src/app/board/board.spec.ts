import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare, squareName } from '../../engine/board';
import { applyMove, generateLegalMoves } from '../../engine/moves';
import { BoardArray, DARK, LIGHT, Move } from '../../engine/types';
import { Board } from './board';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "a1:light" style list of every rendered piece that isn't fading out, sorted. */
function renderedPieces(fixture: ComponentFixture<Board>): string[] {
  const pieces = fixture.nativeElement.querySelectorAll('[data-testid="piece"]:not(.captured)');
  return [...pieces]
    .map((el) => `${el.getAttribute('data-square')}:${el.getAttribute('data-color')}`)
    .sort();
}

function expectedPieces(board: BoardArray): string[] {
  const result: string[] = [];
  board.forEach((cell, square) => {
    if (cell !== 0) result.push(`${squareName(square)}:${cell > 0 ? 'light' : 'dark'}`);
  });
  return result.sort();
}

function onlyMove(board: BoardArray, side: typeof LIGHT | typeof DARK, notation?: string): Move {
  const moves = generateLegalMoves(board, side, false);
  const move = notation
    ? moves.find((m) => m.path.map(squareName).join('x') === notation)
    : moves[0];
  if (!move) throw new Error(`no such move ${notation}`);
  return move;
}

describe('Board move animation', () => {
  let fixture: ComponentFixture<Board>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(Board);
  });

  async function show(board: BoardArray, kind: 'reset' | 'move', move: Move | null): Promise<void> {
    fixture.componentRef.setInput('board', board);
    fixture.componentRef.setInput('updateKind', kind);
    fixture.componentRef.setInput('lastMove', move);
    await fixture.whenStable();
  }

  it('ends up matching the board when a reply arrives mid multi-jump animation', async () => {
    // Light c3 has the forced chain c3xe5xg7; Dark j10 has a quiet reply afterwards.
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'j10'] });
    await show(start, 'reset', null);

    const capture = onlyMove(start, LIGHT, 'c3xe5xg7');
    const afterCapture = applyMove(start, capture);
    await show(afterCapture, 'move', capture);

    // The computer's reply lands ~200ms later — before the 2-hop slide (2 × 210ms) is done.
    await wait(200);
    const reply = onlyMove(afterCapture, DARK, 'j10xi9');
    const afterReply = applyMove(afterCapture, reply);
    await show(afterReply, 'move', reply);

    await wait(1000);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(afterReply));
    expect(afterReply[parseSquare('g7')]).toBe(1);
  });

  it('slides an uninterrupted multi-jump all the way and removes every captured piece', async () => {
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'j10'] });
    await show(start, 'reset', null);

    const capture = onlyMove(start, LIGHT, 'c3xe5xg7');
    const afterCapture = applyMove(start, capture);
    await show(afterCapture, 'move', capture);

    await wait(1000);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(afterCapture));
  });

  it('draws a multi-jump in progress on the square it has reached, minus what it jumped', async () => {
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'f8', 'j10'] });
    await show(start, 'reset', null);

    // c3 → e5 tapped, c3xe5xg7xe9 not finished yet: nothing has been played.
    fixture.componentRef.setInput('pathSoFar', [parseSquare('c3'), parseSquare('e5')]);
    fixture.componentRef.setInput('capturedSoFar', [parseSquare('d4')]);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(['e5:light', 'f6:dark', 'f8:dark', 'j10:dark']);

    // The selection is dropped without a move (e.g. strict mode toggled): back to the board.
    fixture.componentRef.setInput('pathSoFar', []);
    fixture.componentRef.setInput('capturedSoFar', []);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(start));
  });

  it('finishes a multi-jump from where the in-progress drawing left the piece', async () => {
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'f8', 'j10'] });
    await show(start, 'reset', null);

    fixture.componentRef.setInput('pathSoFar', [
      parseSquare('c3'),
      parseSquare('e5'),
      parseSquare('g7'),
    ]);
    fixture.componentRef.setInput('capturedSoFar', [parseSquare('d4'), parseSquare('f6')]);
    await fixture.whenStable();

    // Last hop tapped: the move is played and the selection cleared in the same update.
    const capture = onlyMove(start, LIGHT, 'c3xe5xg7xe9');
    const afterCapture = applyMove(start, capture);
    fixture.componentRef.setInput('pathSoFar', []);
    fixture.componentRef.setInput('capturedSoFar', []);
    await show(afterCapture, 'move', capture);

    // Only the last hop (over f8, now fading) is left to slide: the piece never jumps back to c3.
    expect(renderedPieces(fixture)).toEqual(['e9:light', 'j10:dark']);
    await wait(500);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(afterCapture));
  });
});
