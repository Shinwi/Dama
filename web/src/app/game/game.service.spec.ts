import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createInitialBoard, squareName } from '../../engine/board';
import { DARK, LIGHT, Move } from '../../engine/types';
import { GameService } from './game.service';

interface Pending {
  side: number;
  resolve: (move: Move | null) => void;
}

/** Replaces the service's AI with one that answers only when the test says so. */
function controllableAi(service: GameService): Pending[] {
  const pending: Pending[] = [];
  (service as unknown as { ai: unknown }).ai = {
    chooseMove: (question: { side: number }) =>
      new Promise<Move | null>((resolve) => pending.push({ side: question.side, resolve })),
  };
  return pending;
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

function tap(service: GameService, ...squares: string[]): void {
  for (const name of squares) {
    const square = [...Array(100).keys()].find((i) => squareName(i) === name)!;
    service.tapSquare(square);
  }
}

describe('GameService computer replies', () => {
  let service: GameService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(GameService);
  });

  it('ignores a reply that arrives after a new game was started', async () => {
    const pending = controllableAi(service);
    tap(service, 'b4', 'a5');
    service.boardSettled(); // the move has played out: the computer is asked
    expect(pending).toHaveLength(1);
    const staleReply = service['controller'].legalMoves[0]; // a legal Dark reply to b4-a5

    service.newGame();
    pending[0].resolve(staleReply);
    await flush();

    expect(service.state().board).toEqual(createInitialBoard());
    expect(service.state().toMove).toBe(LIGHT);
    expect(service.thinking()).toBe(false);
  });

  it('asks again for the new game when the side is switched mid-think', async () => {
    const pending = controllableAi(service);
    tap(service, 'b4', 'a5');
    service.boardSettled();
    const staleReply = service['controller'].legalMoves[0];

    service.newGame({ playerSide: DARK }); // the computer must now open as Light
    expect(pending).toHaveLength(2);
    expect(pending[1].side).toBe(LIGHT);

    pending[0].resolve(staleReply); // old game's Dark reply: ignored
    await flush();
    expect(service.state().board).toEqual(createInitialBoard());

    const opening = service['controller'].legalMoves[0];
    pending[1].resolve(opening);
    await flush();
    expect(service.lastMove()).toEqual(opening);
    expect(service.state().toMove).toBe(DARK);
  });

  it('never plays a reply that is not legal in the current position', async () => {
    const pending = controllableAi(service);
    tap(service, 'b4', 'a5');
    service.boardSettled();
    const before = service.state();

    const bogus: Move = {
      from: 0,
      to: 11,
      path: [0, 11],
      captures: [],
      capturedKing: false,
      piece: -1,
      promotes: false,
    };
    pending[0].resolve(bogus);
    await flush();
    expect(service.state()).toBe(before);
  });
});
