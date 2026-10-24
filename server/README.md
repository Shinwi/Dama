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
  rejoins its seat. A page reload rejoins too: the seat's secret token is kept in that tab's
  `sessionStorage`.

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
   Each tab remembers its own seat, but private mode keeps the two players fully apart, like two
   devices.
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

## Settings (environment variables)

| Variable      | Default | What it does                                                         |
|---------------|---------|----------------------------------------------------------------------|
| `PORT`        | `3000`  | Port to listen on.                                                   |
| `CORS_ORIGIN` | any     | Comma-separated list of web pages (origins) allowed to connect. Checked on every connection, WebSocket included. Fly sets it to `https://shinwi.github.io`. |

## Layout

- `src/rooms.ts`: `RoomManager`, the room logic (create, join, rejoin, play, clean up). No
  networking, so it's tested on its own.
- `src/server.ts`: connects `RoomManager` to Socket.IO, and sends each player their own view of
  the room after every change. Also answers `/health`.
- `src/main.ts`: starts the server.

## Hosting on Fly.io

The server runs on [Fly.io](https://fly.io) as a small Docker container in Madrid (`mad`),
the closest region to Morocco. The live site (any `https://` page) connects to
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
   If `mad` (Madrid) isn't listed, change `primary_region` in `fly.toml`, e.g. to `cdg` (Paris).

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
