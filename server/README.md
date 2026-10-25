# Dama — online server (prototype)

A small Node.js + [Socket.IO](https://socket.io/) server that lets two people play each other
in a **room**. One player creates a room and gets a 4-character code. The friend types the code
in (or opens an invite link). From then on, each move goes through the server.

- **The server is the referee.** It keeps each room's game and checks every move and every
  nfikh with the same rules engine the web app uses (`web/src/engine/`, imported directly). It
  passes an action on to the other player only after checking it.
- **The client doesn't wait for the server.** Your own move appears on the board at once. If
  the server refuses it (which only happens if the two copies got out of step), the board snaps
  back to the server's position.
- **Rooms live in memory.** Restarting the server forgets every room. A room nobody has been
  connected to for 30 minutes is removed.
- **Reconnecting:** if a player's connection drops, Socket.IO reconnects by itself and the page
  rejoins its seat. Reloading the page, or closing the browser and opening the game again,
  goes back into the game too: the seat's secret token is kept in the browser's `localStorage`.
  Typing the code of a room you already have a seat in takes that seat back. Leave room stops
  the automatic return, but keeps the seat for its code. Every move also carries the room code and token, so a move made during a
  drop is accepted once the connection is back, whatever order the messages arrive in. If the
  server never got it, the page sends it again after rejoining.
- **Ending a game other than on the board:**
  - **Resign:** the opponent wins.
  - **Offer a draw:** the opponent accepts or declines. The offer lapses if they play a move
    instead.
  - **Claim the win:** allowed once the opponent has been disconnected for 5 minutes. The server
    checks the time itself (`CLAIM_WIN_AFTER_SECONDS`).
  - Once a game is over, moves are refused.
- **Move timer:** the room's creator picks it (`moveTimeSeconds` on `room:create`; 0 for none).
  The server keeps the time: each `RoomView` has `moveTimeMs` and the time left on the turn
  (`turnLeftMs`). When a turn runs out (plus 1 s of grace for the network), the server skips
  it: a `timeout` action, sent to both players like a move. A move that arrives after that is
  refused ("Out of time."). Three skipped turns in a row lose the game. A rematch keeps the timer.
  `RoomView.actions` lists the game's actions, so a page that snaps to the server's position
  can rebuild its move list.
- **Rematch:** when both players ask for one after a game, the next game starts in the same
  room, with colours swapped and the same rules. `RoomView.game` counts the games, and `seq`
  starts at 0 again. A player who leaves the room takes back their rematch request.
- **Heartbeat:** the server pings every 10 s and drops a connection that hasn't answered
  10 s later, so a phone that lost its signal is noticed within about 20 s.
- **Logs:** one JSON line per event. Watch them with `fly logs`. Secret tokens are never logged.
  - **Rooms and players:** `server_started`, `room_created`, `room_joined`, `player_rejoined`,
    `player_left` (with the reason), `rooms_removed`.
  - **Games:** `action_refused`, `request_refused`, `turn_timed_out`, `game_finished`, `game_resigned`,
    `draw_offered`, `draw_answered`, `win_claimed`, `rematch_asked`, `rematch_declined`,
    `rematch_started`.

The messages are defined in `web/src/protocol/online.ts`.

## Run it on your machine

You need Node.js 22 or newer (`node --version`). Use two terminals.

**Terminal 1: the server**

```bash
cd server
npm install        # first time only
npm run dev        # http://localhost:3000, restarts when you change a file
```

Open http://localhost:3000 in a browser: it should say `Dama server: 0 room(s) open`.

**Terminal 2: the web app**

```bash
cd web
npm install        # first time only
npm start          # http://localhost:4200
```

**Play a game**

1. Open http://localhost:4200, pick **Online → Create room**, then press **Create room**.
   Note the room code. (The **Online** button only shows up when the app can reach the
   server: if it's missing, check that terminal 1 is running.)
2. Open a **second window in private/incognito mode** (or another browser) at
   http://localhost:4200. Pick **Online → Join room**, type the code, and press **Join room**.
   It has to be a separate private window or browser: all normal tabs of one browser share the
   saved seat, so they count as the same player.
3. Play. White moves first, and each move appears on the other screen straight away.

Things to try:

- **Reload either page:** the player goes back into the game.
- **Stop the server** (Ctrl+C in terminal 1) and start it again. The pages show
  "Connection lost. Reconnecting…", then "That game is no longer available." This is expected:
  the rooms only live in memory.
- **Stop the server and go back to the home screen.** The Online button is gone, and an invite
  link says online games aren't available. Start the server again and the button comes back
  the next time the home screen is shown.
- **Copy invite link:** opens the game on "Join room" with the code already filled in.
- **Close the player's browser window and open the game again:** they're back in the game.
  The other player sees "Your opponent lost connection N min ago" in the meantime.

### Play from a phone on the same Wi-Fi

1. Find your computer's local IP address. On macOS: `ipconfig getifaddr en0`. On Windows:
   `ipconfig`, then look for "IPv4 Address". For example, `192.168.1.20`.
2. Start the web app so other devices can reach it: `npm start -- --host 0.0.0.0`.
3. On the phone, open `http://192.168.1.20:4200`. The page connects to the server on port
   3000 of the same address by itself.

If the phone can't connect, your computer's firewall is probably blocking ports 4200 and 3000
from the network.

### Pointing the app at a different server

Over `http://` (your machine), the web app connects to port 3000 on whichever host the page
came from. Over `https://` (the live site), it connects to the hosted server. To use another server,
add `?server=` to the page address, e.g. `http://localhost:4200/?server=http://localhost:3001`.
Set the server's port with `PORT=3001 npm run dev`.

## Commands

```bash
npm run dev        # start, and restart on changes (tsx watch)
npm start          # start once
npm run build      # bundle server + engine into dist/main.js (what production runs)
npm run start:prod # run that bundle with plain node
npm test           # Vitest: room rules (rooms.spec.ts) and real Socket.IO clients (server.spec.ts)
npm run typecheck  # tsc, including the engine files it imports from web/
```

The web app's Playwright suite (`cd web && npm run e2e`) starts this server by itself for
`e2e/online.spec.ts`. You only need to have run `npm install` here once.

## How the app knows the server is there

Each time the home screen is shown, the app asks `GET /health` (answer: `{"ok": true}`, allowed
from any page). The **Online** button only shows if that answer arrives within 2 seconds. An
invite link opened while the server isn't there says "Online games aren't available right now."

## Metrics and stats

How the online game is used, in two places:

- **`/stats`, a public page:** https://dama-server.fly.dev/stats (locally
  http://localhost:3000/stats), plus the same numbers as JSON at `/stats.json`. It shows
  players connected, games being played and rooms waiting right now, and, for today (UTC),
  different players, rooms created, and games started and finished. It refreshes every
  30 seconds. Counts only: no room codes, tokens or player IDs.
- **`/metrics`, Prometheus, for charts:** served on its own port (`METRICS_PORT`, 9091). Fly
  collects it from inside its network (`[metrics]` in `fly.toml`); that port isn't reachable
  from the internet. Locally: http://localhost:9091/metrics.

**Seeing the charts on Fly:**

1. Open https://fly-metrics.net and log in with your Fly account.
2. **Dashboards → New → Import**, and upload `server/grafana-dashboard.json`. Choose Fly's
   Prometheus data source when asked.
3. The **Dama online** dashboard shows:
   - players connected and games being played over time;
   - rooms created and games started and finished, per hour;
   - different players per day, and game length;
   - reconnects and refused moves;
   - the server's memory and event-loop delay.

| Metric | What it counts |
|---|---|
| `dama_rooms_created_total` | Rooms created |
| `dama_games_started_total` | Rooms where the friend joined, so a game started |
| `dama_games_finished_total{result}` | Games that ended: `win` / `draw` on the board, `timeout` (lost on time), `resigned`, `draw_agreed`, `abandoned` (win claimed) |
| `dama_turns_timed_out_total` | Turns skipped because the move timer ran out |
| `dama_rematches_total` | Rematches started |
| `dama_draw_offers_total{answer}` | Draw offers: `offered`, `accepted`, `declined` |
| `dama_moves_total{kind}` | Actions accepted (`move` / `nfikh`) |
| `dama_rooms_open` / `_waiting` / `_active` | Rooms right now: all / one player waiting / game on |
| `dama_players_connected` | Players in a room right now ("active users") |
| `dama_unique_players_today` | Different anonymous players seen today (UTC) |
| `dama_game_duration_seconds`, `dama_game_moves` | Length of finished games (histograms) |
| `dama_rejoins_total`, `dama_rejoin_failures_total` | Players back in their seat after a drop / rejoins refused |
| `dama_actions_refused_total{reason}` | Refused actions: `not_your_turn`, `out_of_time`, `illegal`, `game_over`, `no_room`, … |
| `process_*`, `nodejs_*` | Node.js: memory, CPU, event-loop delay, garbage collection |

**Good to know:**

- **Counters start from zero on each restart** (every deploy). The dashboard uses `increase()`,
  which allows for that.
- **"Today" counts** (on `/stats` and `dama_unique_players_today`) also start again at midnight
  UTC, and after a restart.
- **Different players** are counted by an **anonymous ID**: a random UUID the web app makes
  once per browser and keeps in `localStorage` (`dama.player.v1`). It's sent when creating,
  joining or rejoining a room, held in memory for the day, and never logged or shown. One
  person on two devices counts twice.
- **History:** Fly keeps metrics for a limited time (see Fly's docs). All-time totals would
  need a database.

## Settings (environment variables)

| Variable      | Default | What it does                                                         |
|---------------|---------|----------------------------------------------------------------------|
| `PORT`        | `3000`  | Port to listen on.                                                   |
| `CLAIM_WIN_AFTER_SECONDS` | `300` | How long an opponent must be disconnected before the other player can claim the win. The e2e tests use 3. |
| `METRICS_PORT`| `9091`  | Port for `/metrics` (Prometheus). Keep it private: Fly only scrapes it internally. |
| `CORS_ORIGIN` | any     | Comma-separated list of web pages (origins) allowed to connect. Checked on every connection, WebSocket included. Fly sets it to `https://shinwi.github.io`. |

## Layout

- `src/rooms.ts`: `RoomManager`, the room logic (create, join, rejoin, play, clean up). No
  networking, so it's tested on its own.
- `src/server.ts`: connects `RoomManager` to Socket.IO, and sends each player their own view of
  the room after every change. Also answers `/health`, `/stats` and `/stats.json`.
- `src/metrics.ts`: the Prometheus metrics, the "today" counts (unique players), and the
  `/metrics` server.
- `src/stats.ts`: what `/stats` shows, and the page itself.
- `grafana-dashboard.json`: the dashboard to import into Fly's Grafana.
- `src/main.ts`: starts the server.

## Hosting on Fly.io

The server runs on [Fly.io](https://fly.io) as a small Docker container in Amsterdam (`ams`).
Madrid, closer to Morocco, wasn't available when it was set up. The live site (any `https://` page) connects to
`https://dama-server.fly.dev` (set in `web/src/app/online/server-config.ts`).

- **`server/Dockerfile`** has two stages: it bundles the server and the engine files it uses
  into one JavaScript file, then copies that into a small Node 22 image with only Socket.IO
  installed. It's built from the repo root, because it needs `web/src/engine/` and
  `web/src/protocol/`.
- **`fly.toml`** (repo root) sets up **one** machine that never stops, health checks on
  `/health`, and `CORS_ORIGIN=https://shinwi.github.io`, so only the game's own pages can
  connect.
- **`.github/workflows/deploy-server.yml`** tests the server on pull requests. When `master`
  changes the server, the engine or the message types, it tests and then deploys. Until the
  `FLY_API_TOKEN` secret is set, it skips the deploy with a notice instead of failing.

Two rules come from the rooms living in the server's memory:

- **Exactly one machine.** Two machines wouldn't know each other's rooms. That's why deploys
  use `--ha=false` (Fly would otherwise start two), and why the machine never auto-stops.
- **A deploy restarts the server and ends any games in progress.** Deploy when nobody's
  playing.

### One-time setup (on your computer)

1. **Install the `fly` command-line tool:**
   ```bash
   brew install flyctl                       # macOS with Homebrew
   curl -L https://fly.io/install.sh | sh    # macOS / Linux without Homebrew
   ```
   On Windows, in PowerShell: `iwr https://fly.io/install.ps1 -useb | iex`

2. **Log in.** This opens the browser:
   ```bash
   fly auth login
   ```
   Fly asks for a payment card before it runs any machines. One `shared-cpu-1x` machine with
   256 MB costs about $2–3 a month (check fly.io/docs/about/pricing).

3. **Create the app, from the repo root:**
   ```bash
   fly apps create dama-server
   ```
   App names are global across all Fly users. If `dama-server` is taken, pick another name
   (e.g. `dama-shinwi`) and change it in **both** places: `app` in `fly.toml`, and
   `HOSTED_SERVER_URL` in `web/src/app/online/server-config.ts`.

4. **Check the region.** Fly sometimes retires regions:
   ```bash
   fly platform regions
   ```
   `fly.toml` uses `ams` (Amsterdam). To move closer to Morocco later, pick a listed region
   (e.g. `mad` Madrid or `cdg` Paris, if offered) and change `primary_region` in `fly.toml`.

5. **Deploy, from the repo root.** Fly builds the image on its own servers, so you don't
   need Docker installed:
   ```bash
   fly deploy --remote-only --ha=false
   ```

6. **Check it's up:**
   ```bash
   curl https://dama-server.fly.dev/health   # {"ok":true}
   fly status                                # one machine, "started", health check passing
   fly logs                                  # "Dama server listening ... (accepting https://shinwi.github.io)"
   ```

7. **Let GitHub deploy from now on.** Create a deploy token:
   ```bash
   fly tokens create deploy --expiry 8760h   # valid for a year
   ```
   Copy the whole output (it starts with `FlyV1`). In the GitHub repo, go to **Settings →
   Secrets and variables → Actions → New repository secret**. Name it `FLY_API_TOKEN` and
   paste the token.

Fly's own "deploy from GitHub" option on its dashboard isn't needed: the workflow above does
the deploying.

### Everyday commands

```bash
fly status                    # is it running, and on how many machines (should be 1)
fly logs                      # live server output
fly deploy --remote-only --ha=false   # deploy by hand (GitHub does this on master)
fly apps restart dama-server  # restart it (ends games in progress)
fly scale count 1             # if there are ever two machines, go back to one
```

## Not done yet (prototype)

- **Surviving restarts:** a deploy or restart ends the games in progress, since rooms live
  only in memory.
- **Game controls:** no rematch, resign, draw offer or move clock. Leave the room and create a
  new one for another game.
- **Spectators:** a third person trying to join is turned away.
