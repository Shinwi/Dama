import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import type { GameOverInfo } from '../app';
import { ReactionId } from '../../protocol/online';
import { ReactionBar } from '../reactions/reaction-bar';

/**
 * The card over the board when a game ends: the result, why, and what next. Offline: New game.
 * Online: Rematch (both players must ask; the request shows on the other side) or Back to menu.
 */
@Component({
  selector: 'app-game-over-card',
  templateUrl: './game-over-card.html',
  styleUrl: './game-over-card.css',
  imports: [ReactionBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameOverCard {
  readonly info = input.required<GameOverInfo>();
  /** Pieces you took, moves played, how long it took, your best multi-capture. */
  readonly stats = input<{ taken: number; moves: number; time: string; bestCombo: number } | null>(null);
  /** Online: rematch requests instead of New game. Null offline. */
  readonly rematch = input<{ you: boolean; opponent: boolean } | null>(null);

  /** Quick replies to send from here ("Good game"), or none. */
  readonly reactions = input<readonly ReactionId[]>([]);

  readonly newGame = output<void>();
  readonly react = output<ReactionId>();
  readonly menu = output<void>();
  /** Online: true asks for a rematch (or accepts the opponent's), false declines or takes it back. */
  readonly answerRematch = output<boolean>();

  private readonly firstButton = viewChild<ElementRef<HTMLButtonElement>>('first');

  /** Moves keyboard and screen-reader focus to the card's main button. */
  focus(): void {
    this.firstButton()?.nativeElement.focus();
  }
}
