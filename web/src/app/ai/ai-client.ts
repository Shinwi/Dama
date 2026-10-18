import { chooseMove } from '../../engine/ai';
import { Move } from '../../engine/types';
import { AiRequest, AiResponse } from './ai-protocol';

/** Floor on how long a reply takes to feel like a deliberate beat, not an instant reflex. */
const MIN_THINK_MS = 200;

/**
 * Runs the AI in a Web Worker so the page never freezes during a deep search, falling back
 * to the main thread if the worker can't be created or throws. Also enforces MIN_THINK_MS
 * as a floor (not an added delay) so a near-instant reply (e.g. Beginner) still feels
 * considered, without slowing down replies that already take real compute time.
 */
export class AiClient {
  private worker: Worker | null = null;

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./ai.worker', import.meta.url), { type: 'module' });
    } catch {
      this.worker = null;
    }
  }

  async chooseMove(request: AiRequest): Promise<Move | null> {
    const start = Date.now();
    const move = await this.runWorkerOrFallback(request);
    const elapsed = Date.now() - start;
    if (elapsed < MIN_THINK_MS) {
      await delay(MIN_THINK_MS - elapsed);
    }
    return move;
  }

  private async runWorkerOrFallback(request: AiRequest): Promise<Move | null> {
    if (!this.worker) {
      return chooseMove(request.board, request.side, request.options);
    }
    try {
      return await this.runOnWorker(this.worker, request);
    } catch {
      this.worker.terminate();
      this.worker = null;
      return chooseMove(request.board, request.side, request.options);
    }
  }

  private runOnWorker(worker: Worker, request: AiRequest): Promise<Move | null> {
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<AiResponse>) => {
        cleanup();
        resolve(event.data.move);
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(event.error ?? new Error('AI worker failed'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
