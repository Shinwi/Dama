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

    button {
      height: 44px;
      min-width: 44px;
      padding: 0 14px;
      border-radius: 22px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }

    button.face {
      padding: 0;
      color: var(--color-accent);
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
