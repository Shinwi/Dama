import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LIGHT, Side } from '../../engine/types';
import { LOW_TIME_MS } from '../game/game.service';
import { CapturedStacks } from './captured-stacks';

/** One player on the scoreboard. */
export interface ScoreboardPlayer {
  side: Side;
  /** "You", "Opponent", "Computer", or the colour in 1v1. */
  name: string;
  /** How many of the other side's pieces this player has taken: their score. */
  captured: number;
  /** What their tab says on their turn: "Your move", "Thinking…", … */
  turnLabel: string;
}

interface Tab extends ScoreboardPlayer {
  color: 'light' | 'dark';
  /** The other side's colour: the pieces this player has captured. */
  capturedColor: 'light' | 'dark';
  active: boolean;
  low: boolean;
  /** The clock's text, or null when there's no move timer. */
  clock: string | null;
}

/**
 * The score, like a football broadcast's: the two players in one bar, pieces captured as
 * the score, and each player's move clock hanging underneath. The player to move is lit up,
 * and turns red in their last 10 seconds. Presentational: App works out what to show.
 */
@Component({
  selector: 'app-scoreboard',
  imports: [CapturedStacks],
  templateUrl: './scoreboard.html',
  styleUrl: './scoreboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'scoreboard', role: 'region', 'aria-label': 'Score' },
})
export class Scoreboard {
  /** Left, then right: the player first, or White first in 1v1. */
  readonly players = input.required<readonly [ScoreboardPlayer, ScoreboardPlayer]>();
  /** The side to move, or null once the game is over. */
  readonly toMove = input<Side | null>(null);
  /** The running clock: whose, and the time left on it; null while none runs. */
  readonly clock = input<{ side: Side; leftMs: number } | null>(null);
  /** The move timer, or 0 for none. */
  readonly moveTimeMs = input(0);
  readonly moveNumber = input(1);

  protected readonly tabs = computed<Tab[]>(() =>
    this.players().map((player) => {
      const clock = this.clock();
      const running = clock !== null && clock.side === player.side;
      const active = this.toMove() === player.side;
      return {
        ...player,
        color: player.side === LIGHT ? 'light' : 'dark',
        capturedColor: player.side === LIGHT ? 'dark' : 'light',
        active,
        low: active && running && clock.leftMs <= LOW_TIME_MS,
        clock: this.moveTimeMs() > 0 ? formatClock(running ? clock.leftMs : this.moveTimeMs()) : null,
      };
    }),
  );
}

/** "0:24", "1:00": whole seconds, rounded up, so 0:00 means the time is really up. */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
