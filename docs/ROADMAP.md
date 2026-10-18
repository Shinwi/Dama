# Roadmap

Assumes roughly 6–8 hours of work per week. Start a phase only after the previous one is
deployed and real people have played it.

| # | Phase | Start when | Time | Tools |
|---|---|---|---|---|
| **1** | **Offline game (current):** vs computer (3 levels), 1v1 same device, undo, sound/music, deployed | Now | 3–4 weeks | Angular, Vitest, Playwright, Cloudflare Pages / GitHub Pages |
| 2 | Polish & offline: *nfakh* option, move list, installable PWA | Friends played phase 1, rules feel right | 1–2 weeks | `ng add @angular/pwa` |
| 3 | Online rooms with friends: create room → share code → friend joins → live play, reconnect | Phase 2 stable | 3–4 weeks | Node.js + TypeScript, Socket.IO (or Colyseus), shared engine validates every move, `shared/protocol.md`, Docker, Fly.io/Render/Railway in an EU region, always-on |
| 4 | Random opponent: matchmaking queue, move clocks, resign/draw | Rooms reliable | 2–3 weeks | Same server; in-memory queue, Redis only if >1 instance |
| 5 | Accounts: optional login, game history, Elo | Players want progress saved | 3–4 weeks | PostgreSQL, Prisma or Drizzle, Google login |
| 6 | Tournaments: brackets, scheduled rounds, leaderboard | Regular player group | 4–6 weeks | Postgres, scheduled jobs |
| S | Spring Boot backend (learning track): a second backend with the same protocol | After phase 3 works | 4–6 weeks | Spring Boot 3, Java 21, Spring WebSocket, Java engine port passing `rules-cases.json`, JUnit 5; later JPA, Flyway, Spring Security, Testcontainers |

## Principles for later phases

- The server validates every move with the shared engine (anti-cheat), but the client shows
  its own move instantly — never waits on the network to render a move it already knows is
  legal.
- Repo grows into `web/`, `server/`, `shared/`, later `server-spring/`; the same Playwright
  suite runs against either backend.
- Speed and smoothness stay a priority throughout: EU hosting, WebSockets, AI off the main
  thread, PWA caching.
