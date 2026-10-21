/// <reference lib="webworker" />
import { chooseTurn } from '../../engine/ai';
import { AiRequest, AiResponse } from './ai-protocol';

addEventListener('message', ({ data }: MessageEvent<AiRequest>) => {
  const turn = chooseTurn(data.board, data.side, data.forfeitable, data.options);
  const response: AiResponse = { id: data.id, turn };
  postMessage(response);
});
