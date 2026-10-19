/// <reference lib="webworker" />
import { chooseMove } from '../../engine/ai';
import { AiRequest, AiResponse } from './ai-protocol';

addEventListener('message', ({ data }: MessageEvent<AiRequest>) => {
  const move = chooseMove(data.board, data.side, data.options);
  const response: AiResponse = { id: data.id, move };
  postMessage(response);
});
