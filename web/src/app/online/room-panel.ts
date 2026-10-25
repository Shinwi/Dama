import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { OnlineStatus } from '../game/game.service';
import { canShare, shareInvite } from './invite';

/**
 * The online room's code, for the player to pass on to a friend (or a link that fills it
 * in), while they wait for that friend to join; once both are in, RoomChip takes over.
 * Presentational: GameService owns the room.
 */
@Component({
  selector: 'app-room-panel',
  templateUrl: './room-panel.html',
  styleUrl: './room-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', 'aria-label': 'Online room' },
})
export class RoomPanel {
  readonly status = input.required<OnlineStatus>();
  protected readonly copied = signal(false);
  protected readonly canShare = canShare();

  async shareInvite(): Promise<void> {
    if ((await shareInvite(this.status().code)) !== 'copied') return;
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  /** "30s per move", "1 min per move", or "No move timer". */
  protected timerText(): string {
    return describeMoveTime(this.status().moveTimeMs);
  }
}

export function describeMoveTime(ms: number): string {
  if (ms <= 0) return 'No move timer';
  const seconds = Math.round(ms / 1000);
  return seconds % 60 === 0 ? `${seconds / 60} min per move` : `${seconds}s per move`;
}
