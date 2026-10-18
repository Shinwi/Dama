import { AiOptions } from '../../engine/ai';
import { BoardArray, Move, Side } from '../../engine/types';

export interface AiRequest {
  board: BoardArray;
  side: Side;
  options: AiOptions;
}

export interface AiResponse {
  move: Move | null;
}
