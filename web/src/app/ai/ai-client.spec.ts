import { createInitialBoard } from '../../engine/board';
import { generateLegalMoves } from '../../engine/moves';
import { LIGHT, Turn } from '../../engine/types';
import { AiClient } from './ai-client';
import { AiRequest, AiResponse } from './ai-protocol';

/** Stands in for the AI worker: records requests, and replies only when told to. */
class FakeWorker {
  readonly requests: AiRequest[] = [];
  private listeners: ((event: MessageEvent<AiResponse>) => void)[] = [];

  postMessage(request: AiRequest): void {
    this.requests.push(request);
  }
  addEventListener(type: string, listener: (event: MessageEvent<AiResponse>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(type: string, listener: (event: MessageEvent<AiResponse>) => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  terminate(): void {}

  reply(response: AiResponse): void {
    for (const listener of [...this.listeners])
      listener({ data: response } as MessageEvent<AiResponse>);
  }
}

describe('AiClient', () => {
  const board = createInitialBoard();
  const [first, second] = generateLegalMoves(board, LIGHT, false);
  const question = {
    board,
    side: LIGHT,
    forfeitable: [],
    options: { difficulty: 'novice' as const, strictMode: false },
  };

  it('gives each request its own reply, even when an earlier one is answered first', async () => {
    const worker = new FakeWorker();
    const client = new AiClient(worker as unknown as Worker);

    const abandoned = client.chooseTurn(question);
    const current = client.chooseTurn(question);
    const [oldId, newId] = worker.requests.map((r) => r.id);
    expect(oldId).not.toBe(newId);

    // The worker answers in order: the first (since abandoned) request, then the new one.
    const firstTurn: Turn = { nfikh: null, move: first };
    const secondTurn: Turn = { nfikh: null, move: second };
    worker.reply({ id: oldId, turn: firstTurn });
    worker.reply({ id: newId, turn: secondTurn });

    expect(await abandoned).toBe(firstTurn);
    expect(await current).toBe(secondTurn);
  });
});
