import { AiOptions } from '../../engine/ai';
import { BoardArray, Move, Side } from '../../engine/types';

export interface AiRequest {
  /** Echoed back in the response, so a reply can be matched to the request it answers. */
  id: number;
  board: BoardArray;
  side: Side;
  options: AiOptions;
}

export interface AiResponse {
  id: number;
  move: Move | null;
}
