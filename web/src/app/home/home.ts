import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { Difficulty } from '../../engine/ai';
import { DARK, LIGHT, Side } from '../../engine/types';
import { BoardTheme, GameMode, MOVE_TIMES, Settings } from '../game/game-controller';
import { OnlineEntry, OnlineServerState } from '../game/game.service';

export type GameSetup = Pick<Settings, 'mode' | 'difficulty' | 'playerSide' | 'boardTheme' | 'moveTime'> & {
  /** Set when mode is 'online': make a new room, or join a friend's. */
  online?: OnlineEntry;
};

/** What the player picked to play against: a mode, or "Play someone" (an online room with a random opponent). */
export type HomeChoice = GameMode | 'match';

interface ThemeOption {
  id: BoardTheme;
  label: string;
}

/**
 * The start screen: pick the opponent, the difficulty and colour (vs computer), or a room
 * to create or join (online), and the board pattern, then start. Presentational like Board:
 * it starts from `settings` and hands the choices back through `start`; App starts the game.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  readonly settings = input.required<Settings>();
  /** A room code from an invite link (`?room=K7QX`): opens on "Join room" with it filled in. */
  readonly inviteCode = input<string | null>(null);
  /** Whether the online server is there: the Online option only shows when it is. */
  readonly onlineServer = input<OnlineServerState>('checking');
  /** Connecting to the online server: the start button waits. */
  readonly busy = input(false);
  /** Players in rooms on the server right now, if known. */
  readonly playersOnline = input<number | null>(null);
  /** Why the last attempt to get into a room failed. */
  readonly error = input<string | null>(null);
  readonly start = output<GameSetup>();

  protected readonly LIGHT = LIGHT;
  protected readonly DARK = DARK;

  protected readonly themes: ThemeOption[] = [
    { id: 'classic', label: 'Classic' },
    { id: 'wood', label: 'Wood' },
    { id: 'green', label: 'Green' },
  ];

  /** The opponent the player picked (or last played, or an invite link's "online"). */
  private readonly chosenMode = linkedSignal<HomeChoice>(() => (this.inviteCode() ? 'online' : this.settings().mode));
  /**
   * What's actually selected: Online falls back to Vs computer while the server isn't there,
   * and comes back by itself if the server turns up, unless the player has picked since.
   */
  protected readonly mode = computed<HomeChoice>(() => {
    const mode = this.chosenMode();
    return (mode === 'online' || mode === 'match') && this.onlineServer() !== 'up' ? 'computer' : mode;
  });
  protected readonly onlineAvailable = computed(() => this.onlineServer() === 'up');
  /** An invite link was opened, but there's no server to join through. */
  protected readonly inviteUnavailable = computed(() => !!this.inviteCode() && this.onlineServer() === 'down');
  protected readonly onlineEntry = linkedSignal<'create' | 'join'>(() => (this.inviteCode() ? 'join' : 'create'));
  protected readonly roomCode = linkedSignal(() => this.inviteCode() ?? '');
  protected readonly difficulty = linkedSignal<Difficulty>(() => this.settings().difficulty);
  protected readonly playerSide = linkedSignal<Side>(() => this.settings().playerSide);
  protected readonly boardTheme = linkedSignal<BoardTheme>(() => this.settings().boardTheme);
  protected readonly moveTime = linkedSignal(() => this.settings().moveTime);

  protected readonly moveTimes = MOVE_TIMES.map((seconds) => ({
    seconds,
    label: seconds === 0 ? 'No timer' : seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`,
  }));
  /** Joining a room plays by its creator's timer, so there's nothing to pick then. */
  protected readonly showMoveTime = computed(() => this.mode() !== 'online' || this.onlineEntry() === 'create');

  /** The 2×2 corner of the board drawn in each pattern's swatch. */
  protected readonly miniSwatch = [false, true, true, false];

  /** Under "Someone new": how many are playing, when the server says. */
  protected readonly playersLine = computed(() => {
    const n = this.playersOnline();
    return n === null || n === 0 ? 'A random opponent' : `${n} player${n === 1 ? '' : 's'} at the tables`;
  });

  protected readonly startLabel = computed(() => {
    if (this.busy()) return 'Connecting…';
    if (this.mode() === 'match') return 'Find a player';
    if (this.mode() !== 'online') return 'Start game';
    return this.onlineEntry() === 'create' ? 'Create room' : 'Join room';
  });

  protected readonly canStart = computed(
    () => !this.busy() && !(this.mode() === 'online' && this.onlineEntry() === 'join' && this.roomCode().trim().length === 0),
  );

  setMode(mode: HomeChoice): void {
    this.chosenMode.set(mode);
  }

  setRoomCode(event: Event): void {
    this.roomCode.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  startGame(): void {
    if (!this.canStart()) return;
    const choice = this.mode();
    const online: OnlineEntry | undefined =
      choice === 'match'
        ? { kind: 'match' }
        : choice !== 'online'
          ? undefined
          : this.onlineEntry() === 'create'
            ? { kind: 'create' }
            : { kind: 'join', code: this.roomCode().trim() };
    this.start.emit({
      mode: choice === 'match' ? 'online' : choice,
      difficulty: this.difficulty(),
      playerSide: this.playerSide(),
      boardTheme: this.boardTheme(),
      moveTime: this.moveTime(),
      online,
    });
  }
}
