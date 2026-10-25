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

describe('Board coordinates', () => {
  let fixture: ComponentFixture<Board>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(Board);
    fixture.componentRef.setInput('board', boardFrom({}));
  });

  const labels = (selector: string): string =>
    [...fixture.nativeElement.querySelectorAll(selector)]
      .map((e: Element) => e.textContent?.trim())
      .join(' ');

  it('labels files a-j along the bottom and ranks 10-1 down the left, playing Light', async () => {
    await fixture.whenStable();
    expect(labels('.coords-files span')).toBe('a b c d e f g h i j');
    expect(labels('.coords-ranks span')).toBe('10 9 8 7 6 5 4 3 2 1');
  });

  it('follows the board when it is flipped (playing Dark)', async () => {
    fixture.componentRef.setInput('flipped', true);
    await fixture.whenStable();
    expect(labels('.coords-files span')).toBe('j i h g f e d c b a');
    expect(labels('.coords-ranks span')).toBe('1 2 3 4 5 6 7 8 9 10');
  });

  it('keeps the labels outside the board and hidden from screen readers', async () => {
    await fixture.whenStable();
    const board = fixture.nativeElement.querySelector('.board');
    const strips = [...fixture.nativeElement.querySelectorAll('.coords')] as HTMLElement[];
    expect(strips).toHaveLength(2);
    expect(
      strips.every((s) => s.getAttribute('aria-hidden') === 'true' && !board.contains(s)),
    ).toBe(true);
  });
});

describe('Board nfikh', () => {
  it('fades out a piece taken by nfikh without moving anything else', async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Board);
    const start = boardFrom({ light: ['c3', 'a1'], dark: ['d4', 'j10'] });
    fixture.componentRef.setInput('board', start);
    fixture.componentRef.setInput('updateKind', 'reset');
    await fixture.whenStable();

    const after = start.slice();
    after[parseSquare('c3')] = 0;
    fixture.componentRef.setInput('board', after);
    fixture.componentRef.setInput('updateKind', 'nfikh');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="piece"][data-square="c3"].captured')).not.toBeNull();
    expect(renderedPieces(fixture)).toEqual(expectedPieces(after));

    await wait(400);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-square="c3"][data-testid="piece"]')).toBeNull();
  });
});

describe('Board refused tap', () => {
  it('flashes the tapped square and shakes the piece, each time, with no CSS classes needed', async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Board);
    fixture.componentRef.setInput('board', boardFrom({ light: ['b4'] }));
    await fixture.whenStable();

    // jsdom has no Web Animations: record the calls instead.
    const played: string[] = [];
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = function (this: HTMLElement) {
      played.push(this.getAttribute('data-square') ?? this.className);
      return {} as Animation;
    };
    try {
      fixture.componentRef.setInput('rejectedTap', { square: parseSquare('e5'), shake: parseSquare('b4'), id: 1 });
      await fixture.whenStable();
      expect(played).toEqual(['e5', 'piece-disc']);

      fixture.componentRef.setInput('rejectedTap', { square: parseSquare('e5'), shake: null, id: 2 });
      await fixture.whenStable();
      expect(played).toEqual(['e5', 'piece-disc', 'e5']); // again, same square
    } finally {
      HTMLElement.prototype.animate = original;
    }
  });
});
