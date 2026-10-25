import { Today } from './metrics';
import { RoomCounts } from './rooms';

/** What the public `/stats` page shows: counts only, nothing about who is playing. */
export interface StatsSnapshot {
  now: {
    roomsOpen: number;
    roomsWaiting: number;
    roomsActive: number;
    playersConnected: number;
  };
  /** Since midnight UTC, or since the server last started if that was later. */
  today: {
    date: string;
    roomsCreated: number;
    gamesStarted: number;
    gamesFinished: number;
    uniquePlayers: number;
  };
  server: {
    startedAt: string;
    uptimeSeconds: number;
  };
}

export function statsSnapshot(counts: RoomCounts, today: Today, startedAt: number, now: number): StatsSnapshot {
  return {
    now: {
      roomsOpen: counts.open,
      roomsWaiting: counts.waiting,
      roomsActive: counts.active,
      playersConnected: counts.playersConnected,
    },
    today: {
      date: today.date,
      roomsCreated: today.roomsCreated,
      gamesStarted: today.gamesStarted,
      gamesFinished: today.gamesFinished,
      uniquePlayers: today.uniquePlayers,
    },
    server: {
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((now - startedAt) / 1000),
    },
  };
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} days`;
}

/** A small page that reads well on a phone, and refreshes itself every 30 seconds. */
export function statsPage(stats: StatsSnapshot): string {
  const row = (label: string, value: number | string) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Dama online stats</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f1e7; --card: #fff; --text: #221a10; --muted: #6b5f4d; --line: #ddd0b8; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15121b; --card: #211c2b; --text: #efe9f5; --muted: #ad9fc2; --line: #3a3348; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.4 system-ui, sans-serif; }
  main { max-width: 460px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 8px 0 16px; }
  h2 { font-size: 1rem; color: var(--muted); margin: 20px 0 6px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { padding: 10px 14px; border-bottom: 1px solid var(--line); text-align: left; }
  tr:last-child th, tr:last-child td { border-bottom: none; }
  th { font-weight: normal; }
  td { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  p { color: var(--muted); font-size: 0.85rem; }
</style>
</head>
<body>
<main>
<h1>Dama online</h1>
<h2>Right now</h2>
<table>
${row('Players connected', stats.now.playersConnected)}
${row('Games being played', stats.now.roomsActive)}
${row('Rooms waiting for a friend', stats.now.roomsWaiting)}
${row('Rooms open', stats.now.roomsOpen)}
</table>
<h2>Today (${stats.today.date}, UTC)</h2>
<table>
${row('Different players', stats.today.uniquePlayers)}
${row('Rooms created', stats.today.roomsCreated)}
${row('Games started', stats.today.gamesStarted)}
${row('Games finished', stats.today.gamesFinished)}
</table>
<p>Server up for ${duration(stats.server.uptimeSeconds)}. "Today" counts start again at midnight UTC and when the
server restarts (each deploy). Players are counted by a random ID made on their device, nothing personal.
Refreshes every 30 seconds. <a href="stats.json">JSON</a></p>
</main>
</body>
</html>
`;
}
