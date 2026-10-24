import { describe, expect, it } from 'vitest';
import { boardFrom, parseSquare } from '../../web/src/engine/board';
import { DARK, LIGHT } from '../../web/src/engine/types';
import { refusalReason, ServerMetrics, Today, utcDay } from './metrics';
import { RoomManager } from './rooms';
import { statsPage, statsSnapshot } from './stats';

const DAY = 24 * 60 * 60 * 1000;
const ID = '3f1c2b9e-1d4a-4c55-9f0e-2a7b6c8d9e01';

describe('Today', () => {
  it('counts each anonymous player once a day, and starts again at midnight UTC', () => {
    let time = Date.UTC(2026, 9, 24, 23, 0);
    const today = new Today(() => time);
    today.seePlayer(ID);
    today.seePlayer(ID);
    today.seePlayer('aaaaaaaa-2222');
    today.count('roomsCreated');
    expect(today.uniquePlayers).toBe(2);
    expect(today.date).toBe('2026-10-24');

    time += 2 * 60 * 60 * 1000; // 01:00 the next day
    expect(today.uniquePlayers).toBe(0);
    expect(today.roomsCreated).toBe(0);
    expect(today.date).toBe('2026-10-25');
  });

  it('ignores anything that is not a plausible random ID', () => {
    const today = new Today();
    for (const junk of [undefined, null, 42, '', 'short', 'x'.repeat(65), 'has spaces in it', { id: ID }]) today.seePlayer(junk);
    expect(today.uniquePlayers).toBe(0);
  });

  it('knows the UTC day of a time', () => {
    expect(utcDay(Date.UTC(2026, 0, 1, 0, 0) - 1)).toBe('2025-12-31');
    expect(utcDay(Date.UTC(2026, 0, 1) + DAY / 2)).toBe('2026-01-01');
  });
});

describe('RoomManager counts', () => {
  it('counts rooms waiting, active, and players connected', () => {
    const rooms = new RoomManager();
    rooms.create(LIGHT, false); // waiting
    const { room } = rooms.create(LIGHT, false);
    rooms.join(room.code); // active
    expect(rooms.counts()).toEqual({ open: 2, waiting: 1, active: 1, playersConnected: 3 });

    rooms.setConnected(room, LIGHT, false);
    rooms.setConnected(room, DARK, false);
    expect(rooms.counts()).toEqual({ open: 2, waiting: 1, active: 0, playersConnected: 1 });
  });

  it('reports a game as finished once, with how long it took', () => {
    let time = 1000;
    const rooms = new RoomManager(Math.random, () => time);
    const { room } = rooms.create(LIGHT, false);
    time = 5000;
    rooms.join(room.code);
    room.state = { ...room.state, board: boardFrom({ light: ['c3'], dark: ['d4'] }) };
    time = 65_000;
    const played = rooms.play(room, LIGHT, { kind: 'move', path: [parseSquare('c3'), parseSquare('e5')] });
    expect(played).toEqual({ ok: true, value: { finished: { result: 'win', durationMs: 60_000, actions: 1 } } });
    expect(rooms.counts().active).toBe(0); // over, so no longer active
  });
});

describe('ServerMetrics', () => {
  function setUp() {
    const rooms = new RoomManager();
    const metrics = new ServerMetrics(() => rooms.counts(), { nodeMetrics: false });
    return { rooms, metrics };
  }

  it('renders the room and player numbers in Prometheus format', async () => {
    const { rooms, metrics } = setUp();
    const { room } = rooms.create(LIGHT, false);
    metrics.roomCreated();
    rooms.join(room.code);
    metrics.gameStarted();
    metrics.playerSeen(ID);
    metrics.actionPlayed('move', null);
    metrics.actionPlayed('move', { result: 'win', durationMs: 600_000, actions: 42 });
    metrics.actionRefused('Not your turn.');
    metrics.rejoined();

    const text = await metrics.render();
    expect(text).toContain('dama_rooms_created_total 1');
    expect(text).toContain('dama_games_started_total 1');
    expect(text).toContain('dama_rooms_active 1');
    expect(text).toContain('dama_players_connected 2');
    expect(text).toContain('dama_unique_players_today 1');
    expect(text).toContain('dama_moves_total{kind="move"} 2');
    expect(text).toContain('dama_games_finished_total{result="win"} 1');
    expect(text).toContain('dama_actions_refused_total{reason="not_your_turn"} 1');
    expect(text).toContain('dama_rejoins_total 1');
    expect(text).toContain('dama_game_duration_seconds_sum 600');
    expect(text).not.toContain(ID); // IDs are counted, never shown
  });

  it('labels refusals with a short reason', () => {
    expect(refusalReason('Illegal move.')).toBe('illegal');
    expect(refusalReason('That piece cannot be taken.')).toBe('illegal');
    expect(refusalReason('That game is no longer available.')).toBe('no_room');
    expect(refusalReason('Something new')).toBe('other');
  });
});

describe('stats page', () => {
  it('shows the numbers, and nothing about who is playing', () => {
    const rooms = new RoomManager();
    const { room } = rooms.create(LIGHT, false);
    rooms.join(room.code);
    const today = new Today();
    today.seePlayer(ID);
    today.count('gamesStarted');
    const snapshot = statsSnapshot(rooms.counts(), today, 0, 3 * 60 * 60 * 1000);
    expect(snapshot.now).toEqual({ roomsOpen: 1, roomsWaiting: 0, roomsActive: 1, playersConnected: 2 });
    expect(snapshot.today).toMatchObject({ gamesStarted: 1, uniquePlayers: 1 });
    expect(snapshot.server.uptimeSeconds).toBe(3 * 60 * 60);

    const html = statsPage(snapshot);
    expect(html).toContain('<td>2</td>'); // players connected
    expect(html).toContain('3 h 0 min');
    expect(html).not.toContain(room.code);
    expect(html).not.toContain(ID);
  });
});
