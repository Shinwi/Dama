import { AiOptions } from '../../engine/ai';
import { BoardArray, Side, Turn } from '../../engine/types';

export interface AiRequest {
  /** Echoed back in the response, so a reply can be matched to the request it answers. */
  id: number;
  board: BoardArray;
  side: Side;
  /** The opponent's pieces the computer may take by nfikh before moving. */
  forfeitable: number[];
  options: AiOptions;
}

export interface AiResponse {
  id: number;
  turn: Turn | null;
}
