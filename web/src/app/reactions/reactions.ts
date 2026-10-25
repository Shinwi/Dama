import { ReactionId } from '../../protocol/online';

/** How a reaction shows: a face (an icon), or a short phrase. */
export interface ReactionInfo {
  kind: 'face' | 'phrase';
  /** What it says: the phrase itself, or the face's name (for screen readers). */
  label: string;
}

/** Every reaction's look and words. A design can show any selection of them. */
export const REACTION_INFO: Record<ReactionId, ReactionInfo> = {
  happy: { kind: 'face', label: 'Happy' },
  laugh: { kind: 'face', label: 'Laughing' },
  wow: { kind: 'face', label: 'Wow' },
  oops: { kind: 'face', label: 'Oops' },
  grumpy: { kind: 'face', label: 'Grumpy' },
  cheeky: { kind: 'face', label: 'Cheeky' },
  thinking: { kind: 'face', label: 'Thinking' },
  'good-move': { kind: 'phrase', label: 'Good move' },
  hurry: { kind: 'phrase', label: 'Hurry!' },
  'take-your-time': { kind: 'phrase', label: 'Take your time' },
  'good-game': { kind: 'phrase', label: 'Good game' },
  'well-played': { kind: 'phrase', label: 'Well played' },
  'one-more': { kind: 'phrase', label: 'One more?' },
};
