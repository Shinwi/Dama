import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ReactionId } from '../../protocol/online';
import { ShownReaction } from '../game/game.service';
import { REACTION_INFO } from './reactions';
import { ReactionFace } from './reaction-face';

/**
 * A reaction someone just sent, as a speech bubble: "Opponent: Nice move!". It sits over
 * the page (App positions it), so its coming and going never moves anything.
 */
@Component({
  selector: 'app-reaction-bubble',
  imports: [ReactionFace],
  template: `
    @if (shown(); as r) {
      <p class="bubble" [class.right]="align() === 'right'" [attr.data-from]="r.from" data-testid="reaction-bubble" aria-live="polite">
        @if (r.face) {
          <span class="who">{{ r.from }}</span>
          <app-reaction-face class="face" [face]="r.id" [size]="faceSize()"></app-reaction-face>
          <span class="visually-hidden">{{ r.label }}</span>
        } @else {
          <span class="who">{{ r.from }}:</span> {{ r.label }}
        }
      </p>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      height: 0;
      z-index: 5;
    }

    /* Design B, "Night Café": a cream pill that drops in above the board. */
    .bubble {
      position: absolute;
      left: 50%;
      top: 4px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px 6px 8px;
      border-radius: 999px;
      background: #f2e9d8;
      color: #1b1408;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
      font-weight: 700;
      font-size: 0.92rem;
      white-space: nowrap;
      transform: translateX(-50%);
      animation: drop 200ms ease-out;
    }

    .who {
      color: #5a4a2a;
      font-weight: 600;
    }

    .face {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(180deg, #f0c878, #c48f37);
      color: #2a1d05;
    }

    @keyframes drop {
      from {
        transform: translate(-50%, -10px);
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .bubble {
        animation: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionBubble {
  readonly reaction = input<ShownReaction | null>(null);
  /** Who sent it, in words ("You", "Opponent", "White"…). */
  readonly from = input('');
  /** Which side of the screen it points from. */
  readonly align = input<'left' | 'right'>('left');
  readonly faceSize = input(22);
  readonly labels = input<Partial<Record<ReactionId, string>>>({});

  protected readonly shown = computed(() => {
    const r = this.reaction();
    if (!r) return null;
    const info = REACTION_INFO[r.reaction];
    return { id: r.reaction, key: r.id, face: info.kind === 'face', label: this.labels()[r.reaction] ?? info.label, from: this.from() };
  });
}
