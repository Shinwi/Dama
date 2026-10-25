import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { MatchmakingStatus } from '../game/game.service';
import { describeMoveTime } from '../online/room-panel';

/**
 * "Play someone": looking for a random opponent, how long for, and how many players are
 * on. If the server can't match players yet, says so, and offers the computer instead.
 */
@Component({
  selector: 'app-matchmaking',
  templateUrl: './matchmaking.html',
  styleUrl: './matchmaking.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'matchmaking' },
})
export class Matchmaking {
  readonly status = input.required<MatchmakingStatus>();
  readonly playersOnline = input<number | null>(null);
  readonly moveTimeMs = input(0);
  readonly cancel = output<void>();
  readonly playComputer = output<void>();

  private readonly now = signal(Date.now());

  /** The little board on the table: 4×4. */
  protected readonly squares = Array.from({ length: 16 }, (_, i) => (Math.floor(i / 4) + i) % 2 === 1);

  protected readonly waited = computed(() => {
    const seconds = Math.max(0, Math.floor((this.now() - this.status().since) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  protected readonly players = computed(() => {
    const n = this.playersOnline();
    return n === null ? null : `${n} player${n === 1 ? '' : 's'} online`;
  });

  protected readonly timer = computed(() => describeMoveTime(this.moveTimeMs()));

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
