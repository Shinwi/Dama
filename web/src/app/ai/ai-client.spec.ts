import { createInitialBoard } from '../../engine/board';
import { generateLegalMoves } from '../../engine/moves';
import { LIGHT, Move } from '../../engine/types';
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
    options: { difficulty: 'novice' as const, strictMode: false },
  };

  it('gives each request its own reply, even when an earlier one is answered first', async () => {
    const worker = new FakeWorker();
    const client = new AiClient(worker as unknown as Worker);

    const abandoned = client.chooseMove(question);
    const current = client.chooseMove(question);
    const [oldId, newId] = worker.requests.map((r) => r.id);
    expect(oldId).not.toBe(newId);

    // The worker answers in order: the first (since abandoned) request, then the new one.
    worker.reply({ id: oldId, move: first });
    worker.reply({ id: newId, move: second });

    expect(await abandoned).toBe(first);
    expect(await current).toBe(second as Move);
  });
});
