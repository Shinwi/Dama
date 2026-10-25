import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ReactionId } from '../../protocol/online';
import { REACTION_INFO } from './reactions';
import { ReactionFace } from './reaction-face';

/**
 * The quick reactions a player can send: faces first, then phrases. Presentational: App
 * sends the picked one through GameService. Each design picks which reactions to offer.
 */
@Component({
  selector: 'app-reaction-bar',
  imports: [ReactionFace],
  template: `
    @for (choice of choices(); track choice.id) {
      <button
        type="button"
        [class]="choice.kind"
        [attr.data-reaction]="choice.id"
        [attr.aria-label]="choice.kind === 'face' ? choice.label : null"
        [disabled]="disabled()"
        (click)="pick.emit(choice.id)"
      >
        @if (choice.kind === 'face') {
          <app-reaction-face [face]="choice.id" [size]="faceSize()"></app-reaction-face>
        } @else {
          {{ choice.label }}
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    /* Design C, "Souk Party": round face stickers in loud colours, then shouted phrases. */
    :host {
      justify-content: space-between;
    }

    button {
      height: 46px;
      min-width: 44px;
      flex: 1 1 auto;
      padding: 0 12px;
      border: 3px solid #1b1b1b;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 3px 3px 0 #1b1b1b;
      color: #1b1b1b;
      font-family: 'Lilita One', sans-serif;
      font-size: 1rem;
      cursor: pointer;
    }

    button.face {
      flex: 0 0 auto;
      width: 58px;
      height: 58px;
      padding: 0;
      border-radius: 50%;
      box-shadow: 3px 4px 0 #1b1b1b;
      --face-fill: #ffe680;
      --face-stroke: 2.2;
    }

    button:active {
      transform: translate(2px, 2px);
      box-shadow: 1px 1px 0 #1b1b1b;
    }

    button[data-reaction='happy'] {
      background: #ffd23f;
    }

    button[data-reaction='laugh'] {
      background: #2ed18b;
    }

    button[data-reaction='wow'] {
      background: #3fa9f5;
    }

    button[data-reaction='grumpy'] {
      background: #ff5a4e;
    }

    button[data-reaction='cheeky'],
    button[data-reaction='oops'],
    button[data-reaction='thinking'] {
      background: #b796ff;
    }

    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', 'aria-label': 'Quick reactions', 'data-testid': 'reactions' },
})
export class ReactionBar {
  readonly reactions = input.required<readonly ReactionId[]>();
  readonly disabled = input(false);
  readonly faceSize = input(24);
  /** Overrides some reactions' wording, for a design with its own voice. */
  readonly labels = input<Partial<Record<ReactionId, string>>>({});
  readonly pick = output<ReactionId>();

  protected readonly choices = computed(() =>
    this.reactions().map((id) => ({ id, kind: REACTION_INFO[id].kind, label: this.labels()[id] ?? REACTION_INFO[id].label })),
  );
}
