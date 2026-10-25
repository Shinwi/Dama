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

    .bubble {
      position: absolute;
      left: 0;
      top: 0;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 4px 16px 16px 16px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      box-shadow: 0 6px 16px rgba(40, 30, 10, 0.14);
      font-weight: 700;
      font-size: 0.92rem;
      white-space: nowrap;
      animation: pop 180ms ease-out;
    }

    .bubble.right {
      left: auto;
      right: 0;
      border-radius: 16px 4px 16px 16px;
    }

    .who {
      color: var(--color-text-muted);
      font-weight: 600;
    }

    .face {
      color: var(--color-accent);
    }

    @keyframes pop {
      from {
        transform: scale(0.6);
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
