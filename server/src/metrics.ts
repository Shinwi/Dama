import { createServer, Server as HttpServer } from 'node:http';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { FinishedGame, RoomCounts } from './rooms';

/** A browser's anonymous player ID: random, made on the device. Anything else is ignored. */
const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Never remember more IDs than this in a day, whatever is sent: memory stays bounded. */
const MAX_PLAYERS_PER_DAY = 100_000;

/** "2026-10-24": the UTC day a time falls on. */
export function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Counts for the current UTC day: rooms created, games started and finished, and the
 * different anonymous player IDs seen. It all starts again at midnight UTC, and on a server
 * restart, since it lives in memory. The IDs are only counted: never logged or shown.
 */
export class Today {
  private day: string;
  private players = new Set<string>();
  roomsCreated = 0;
  gamesStarted = 0;
  gamesFinished = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.day = utcDay(now());
  }

  /** A player was seen (created, joined or rejoined a room). Invalid IDs are ignored. */
  seePlayer(id: unknown): void {
    this.rollOver();
    if (typeof id !== 'string' || !PLAYER_ID.test(id)) return;
    if (this.players.size < MAX_PLAYERS_PER_DAY) this.players.add(id);
  }

  get uniquePlayers(): number {
    this.rollOver();
    return this.players.size;
  }

  get date(): string {
    this.rollOver();
    return this.day;
  }

  count(what: 'roomsCreated' | 'gamesStarted' | 'gamesFinished'): void {
    this.rollOver();
    this[what]++;
  }

  private rollOver(): void {
    const day = utcDay(this.now());
    if (day === this.day) return;
    this.day = day;
    this.players = new Set();
    this.roomsCreated = 0;
    this.gamesStarted = 0;
    this.gamesFinished = 0;
  }
}

/** Why a move was refused, as a short label for the metrics (not the full message). */
export type RefusalReason = 'not_your_turn' | 'illegal' | 'game_over' | 'waiting' | 'invalid' | 'no_room' | 'other';

export function refusalReason(error: string): RefusalReason {
  if (error.startsWith('Not your turn')) return 'not_your_turn';
  if (error.startsWith('Illegal') || error.startsWith('That piece cannot')) return 'illegal';
  if (error.startsWith('The game is over')) return 'game_over';
  if (error.startsWith('Waiting for')) return 'waiting';
  if (error.startsWith('Not a valid')) return 'invalid';
  if (error.startsWith('That game is no longer') || error.startsWith('You are not in a room')) return 'no_room';
  return 'other';
}

/**
 * The server's metrics, in Prometheus format (served on `/metrics`, which Fly collects into
 * its Grafana). Counters count since the server started; Grafana's increase()/rate() handle
 * the restart on each deploy. Gauges (rooms, players) are read from the rooms when scraped.
 */
export class ServerMetrics {
  readonly registry = new Registry();
  readonly today: Today;

  private readonly roomsCreated = new Counter({ name: 'dama_rooms_created_total', help: 'Rooms created', registers: [this.registry] });
  private readonly gamesStarted = new Counter({
    name: 'dama_games_started_total',
    help: 'Rooms where the second player joined, so a game started',
    registers: [this.registry],
  });
  private readonly gamesFinished = new Counter({
    name: 'dama_games_finished_total',
    help: 'Games that ended: win / draw on the board, resigned, draw_agreed, abandoned (win claimed)',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });
  private readonly actions = new Counter({
    name: 'dama_moves_total',
    help: 'Actions accepted (moves and nfikh)',
    labelNames: ['kind'] as const,
    registers: [this.registry],
  });
  private readonly refused = new Counter({
    name: 'dama_actions_refused_total',
    help: 'Actions the server refused, by reason',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });
  private readonly rematches = new Counter({ name: 'dama_rematches_total', help: 'Rematches started', registers: [this.registry] });
  private readonly drawOffers = new Counter({
    name: 'dama_draw_offers_total',
    help: 'Draw offers, by how they were answered (offered, accepted, declined)',
    labelNames: ['answer'] as const,
    registers: [this.registry],
  });
  private readonly rejoins = new Counter({ name: 'dama_rejoins_total', help: 'Players back in their seat after a drop or reload', registers: [this.registry] });
  private readonly rejoinFailures = new Counter({
    name: 'dama_rejoin_failures_total',
    help: 'Rejoins refused (the game was gone)',
    registers: [this.registry],
  });
  private readonly gameDuration = new Histogram({
    name: 'dama_game_duration_seconds',
    help: 'How long finished games lasted',
    buckets: [60, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 7200],
    registers: [this.registry],
  });
  private readonly gameMoves = new Histogram({
    name: 'dama_game_moves',
    help: 'Actions in finished games',
    buckets: [10, 20, 30, 40, 60, 80, 100, 150, 200],
    registers: [this.registry],
  });

  constructor(counts: () => RoomCounts, options: { now?: () => number; nodeMetrics?: boolean } = {}) {
    this.today = new Today(options.now);
    const today = this.today;
    const gauge = (name: string, help: string, read: () => number) =>
      new Gauge({
        name,
        help,
        registers: [this.registry],
        collect() {
          this.set(read());
        },
      });
    gauge('dama_rooms_open', 'Rooms in memory', () => counts().open);
    gauge('dama_rooms_waiting', 'Rooms with one player, waiting for the friend', () => counts().waiting);
    gauge('dama_rooms_active', 'Rooms with both players and a game on', () => counts().active);
    gauge('dama_players_connected', 'Players connected to a room right now', () => counts().playersConnected);
    gauge('dama_unique_players_today', 'Different anonymous players seen today (UTC)', () => today.uniquePlayers);
    // Memory, CPU, event-loop delay, garbage collection: off in tests, to keep them quiet.
    if (options.nodeMetrics !== false) collectDefaultMetrics({ register: this.registry });
  }

  roomCreated(): void {
    this.roomsCreated.inc();
    this.today.count('roomsCreated');
  }

  gameStarted(): void {
    this.gamesStarted.inc();
    this.today.count('gamesStarted');
  }

  actionPlayed(kind: 'move' | 'nfikh'): void {
    this.actions.inc({ kind });
  }

  /** A game ended, however it ended. */
  gameFinished(finished: FinishedGame): void {
    this.gamesFinished.inc({ result: finished.result });
    this.gameDuration.observe(finished.durationMs / 1000);
    this.gameMoves.observe(finished.actions);
    this.today.count('gamesFinished');
  }

  rematchStarted(): void {
    this.rematches.inc();
  }

  drawOffered(): void {
    this.drawOffers.inc({ answer: 'offered' });
  }

  drawAnswered(accepted: boolean): void {
    this.drawOffers.inc({ answer: accepted ? 'accepted' : 'declined' });
  }

  actionRefused(error: string): void {
    this.refused.inc({ reason: refusalReason(error) });
  }

  rejoined(): void {
    this.rejoins.inc();
  }

  rejoinFailed(): void {
    this.rejoinFailures.inc();
  }

  playerSeen(id: unknown): void {
    this.today.seePlayer(id);
  }

  /** The Prometheus text for `/metrics`. */
  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

/**
 * The `/metrics` page, on its own port: Fly collects it from inside its network (see
 * `[metrics]` in fly.toml), and that port isn't reachable from the internet.
 */
export function createMetricsServer(metrics: ServerMetrics): HttpServer {
  return createServer((req, res) => {
    if ((req.url ?? '').split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    void metrics.render().then(
      (text) => {
        res.writeHead(200, { 'content-type': metrics.contentType });
        res.end(text);
      },
      () => res.writeHead(500).end(),
    );
  });
}
