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

  it('plays a reply that arrives mid multi-jump after the multi-jump, not over it', async () => {
    // Light c3 has the forced chain c3xe5xg7; Dark j10 has a quiet reply afterwards.
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'j10'] });
    await show(start, 'reset', null);

    const capture = onlyMove(start, LIGHT, 'c3xe5xg7');
    const afterCapture = applyMove(start, capture);
    await show(afterCapture, 'move', capture);

    // The reply lands ~100ms later, while the capture is still on its first hop.
    await wait(100);
    const reply = onlyMove(afterCapture, DARK, 'j10xi9');
    const afterReply = applyMove(afterCapture, reply);
    await show(afterReply, 'move', reply);

    // Watch the board play out: the capture must reach g7 before the reply leaves j10.
    const frames: string[][] = [];
    for (let t = 0; t < 1000; t += 20) {
      await wait(20);
      await fixture.whenStable();
      frames.push(renderedPieces(fixture));
    }
    const captureLanded = frames.findIndex((f) => f.includes('g7:light'));
    const replyStarted = frames.findIndex((f) => !f.includes('j10:dark'));
    expect(captureLanded).toBeGreaterThanOrEqual(0);
    expect(replyStarted).toBeGreaterThan(captureLanded);
    // …and the piece was never drawn anywhere it shouldn't be on the way.
    for (const f of frames) {
      const light = f.find((p) => p.endsWith(':light'));
      expect(['e5:light', 'g7:light']).toContain(light);
    }

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

    // Only the last hop is left to slide: the piece never jumps back to c3.
    await wait(40);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(['e9:light', 'f8:dark', 'j10:dark']);
    await wait(1000);
    await fixture.whenStable();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(afterCapture));
  });

  it('reports the board settled once, after the move has finished playing', async () => {
    const start = boardFrom({ light: ['c3'], dark: ['d4', 'f6', 'j10'] });
    await show(start, 'reset', null);
    let settled = 0;
    fixture.componentInstance.settled.subscribe(() => settled++);

    const capture = onlyMove(start, LIGHT, 'c3xe5xg7');
    await show(applyMove(start, capture), 'move', capture);
    await wait(200);
    expect(settled).toBe(0); // second hop still to go
    await wait(400);
    expect(settled).toBe(1);
  });
});

describe('Board accessibility', () => {
  let fixture: ComponentFixture<Board>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(Board);
    fixture.componentRef.setInput('board', boardFrom({ light: ['b4', 'c3'], darkKings: ['e7'] }));
  });

  const square = (name: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`button[data-square="${name}"]`);
  const label = (name: string) => square(name).getAttribute('aria-label');
  const press = (key: string) => {
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
  };
  const focused = () => (document.activeElement as HTMLElement).getAttribute('data-square');

  it('says what is on each square', async () => {
    await fixture.whenStable();
    expect(label('b4')).toBe('b4, light man');
    expect(label('e7')).toBe('e7, dark king');
    expect(label('a1')).toBe('a1, empty');
  });

  it('says which piece is selected and where it can go', async () => {
    fixture.componentRef.setInput('selected', parseSquare('b4'));
    fixture.componentRef.setInput('landingDots', [parseSquare('a5'), parseSquare('c5')]);
    fixture.componentRef.setInput('compulsoryRings', [parseSquare('c3')]);
    await fixture.whenStable();
    expect(label('b4')).toBe('b4, light man, selected');
    expect(label('a5')).toBe('a5, empty, you can move here');
    expect(label('c3')).toBe('c3, light man, must capture');

    fixture.componentRef.setInput('landingDots', []);
    fixture.componentRef.setInput('captureRings', [parseSquare('f8')]);
    await fixture.whenStable();
    expect(label('f8')).toBe('f8, empty, you can capture by moving here');
  });

  it('is a single Tab stop, on the bottom-left square to start with', async () => {
    await fixture.whenStable();
    const stops = fixture.nativeElement.querySelectorAll('button[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('data-square')).toBe('a1');
  });

  it('moves focus between playable squares with the arrow keys', async () => {
    await fixture.whenStable();
    square('a1').focus();
    press('ArrowRight');
    expect(focused()).toBe('c1');
    press('ArrowUp');
    expect(focused()).toBe('d2');
    press('ArrowDown');
    expect(focused()).toBe('c1');
    press('ArrowLeft');
    press('ArrowLeft'); // already at the edge: stays put
    expect(focused()).toBe('a1');
    press('ArrowUp');
    press('ArrowUp');
    expect(focused()).toBe('c3');

    // The Tab stop follows focus.
    await fixture.whenStable();
    expect(square('c3').getAttribute('tabindex')).toBe('0');
    expect(square('a1').getAttribute('tabindex')).toBe('-1');
  });

  it('follows the board as drawn when it is flipped', async () => {
    fixture.componentRef.setInput('flipped', true);
    await fixture.whenStable();
    const start = fixture.nativeElement.querySelector('button[tabindex="0"]') as HTMLButtonElement;
    expect(start.getAttribute('data-square')).toBe('j10');
    start.focus();
    press('ArrowRight'); // rightwards on screen is towards a, when flipped
    expect(focused()).toBe('h10');
    press('ArrowUp');
    expect(focused()).toBe('g9');
  });

  it('is a labelled group, not an (invalid) grid', async () => {
    await fixture.whenStable();
    const board = fixture.nativeElement.querySelector('.board');
    expect(board.getAttribute('role')).toBe('group');
    expect(board.getAttribute('aria-label')).toBe('Dama board');
  });
});
