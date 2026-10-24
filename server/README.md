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
   Note the room code.
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

The web app connects to port 3000 on whichever host the page came from. To use another server,
add `?server=` to the page address, e.g. `http://localhost:4200/?server=http://localhost:3001`.
Set the server's port with `PORT=3001 npm run dev`.

## Commands

```bash
npm run dev        # start, and restart on changes (tsx watch)
npm start          # start once
npm test           # Vitest: room rules (rooms.spec.ts) and real Socket.IO clients (server.spec.ts)
npm run typecheck  # tsc, including the engine files it imports from web/
```

The web app's Playwright suite (`cd web && npm run e2e`) starts this server by itself for
`e2e/online.spec.ts`. You only need to have run `npm install` here once.

## Settings (environment variables)

| Variable      | Default | What it does                                                         |
|---------------|---------|----------------------------------------------------------------------|
| `PORT`        | `3000`  | Port to listen on.                                                   |
| `CORS_ORIGIN` | any     | Comma-separated list of web origins allowed to connect, for hosting. |

## Layout

- `src/rooms.ts`: `RoomManager`, the room logic (create, join, rejoin, play, clean up). No
  networking, so it's tested on its own.
- `src/server.ts`: connects `RoomManager` to Socket.IO, and sends each player their own view of
  the room after every change.
- `src/main.ts`: starts the server.

## Not done yet (prototype)

- **Hosting:** the live site on GitHub Pages can't reach a server on your machine. Until the
  server is hosted somewhere and the app is pointed at it, Online only works locally.
- **Game controls:** no rematch, resign, draw offer or move clock. Leave the room and create a
  new one for another game.
- **Persistence:** rooms are lost when the server restarts. There's no database.
- **Spectators:** a third person trying to join is turned away.
