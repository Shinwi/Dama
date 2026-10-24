# Dama (ضامة) — project context for Claude Code

Moroccan checkers (dama), built as a learning project for Angular, Playwright and Node.js.
The user is a QA automation engineer (Java, Selenium, GitLab CI) learning frontend/web tooling.

## Current phase

**Phase 1: offline static game.** Angular SPA, no backend, no accounts. Vs-computer (3
difficulty levels) and 1v1 pass-and-play on one device. See `docs/ROADMAP.md` for what comes
after and `/claude/PLAN.md` for the live working plan.

## Stack

- Angular 20 (standalone components, signals, zoneless change detection, new control flow,
  `inject()`). Node 24.13 on this machine is below Angular 21's minimum, so the project pins
  to Angular 20 — same APIs the spec wants (signals, zoneless, standalone, `@if`/`@for`), just
  one major behind "latest". Revisit once Node is upgraded to 22.22.3+/24.15+/26+.
- TypeScript strict mode.
- Vitest for all unit tests: engine tests run directly (`npm run test:engine`, config
  `web/vitest.engine.config.ts`); component tests run through `ng test` (Angular's
  `@angular/build:unit-test` experimental builder, configured with `runner: vitest` in
  `angular.json`), not Karma/Jasmine.
- Playwright for e2e (`web/e2e/`), two projects: Desktop Chrome and Pixel 7.
- No UI component libraries — hand-made components and CSS.

## Rules

Full plain-language rules: `docs/RULES.md`. Implemented exactly as specified, including:
optional captures punished by *nfikh* (the opponent may take the piece that skipped a capture,
then moves), men capturing forward only (multi-jumps included), kings flying arbitrary
distances, strict-mode (max-capture) toggle, promotion on the move's final landing square, and
the 50-quiet-move draw rule. The UI calls the sides White and Black; the code keeps
`LIGHT`/`DARK`.

## Architecture

```
dama/
  CLAUDE.md
  claude/              CHANGELOG.md and PLAN.md for this project — session-to-session memory
  docs/
    ROADMAP.md
    RULES.md
  web/                 the Angular app
    src/engine/        PURE TypeScript rules + AI (negamax/alpha-beta/quiescence). No Angular
                       imports. Unit tested with plain Vitest. rules-cases.json drives the
                       rule tests. Will move to shared/ in phase 3.
    src/app/game/      game flow controller + signals-based GameService
    src/app/home/      home screen: opponent, difficulty/colour, board pattern, Start game
    src/app/board/     board component (inputs in, square-tap output)
    src/app/ai/        web worker + client wrapping src/engine/ai.ts
    src/app/audio/     synthesized sound engine (Web Audio, no audio files)
    src/app/online/    Socket.IO client for online rooms + the room-code panel
    src/protocol/      online.ts: the client/server message types (plain types only)
    e2e/               Playwright tests
  server/              online rooms prototype: Node.js + Socket.IO, rooms in memory, every
                       action checked with web/src/engine (imported directly). See its README.
```

## Conventions

- Keep game logic out of components; components only render and forward events.
- Board = `Int8Array[100]`, index `row*10+col`, row 0 = rank 1 (Light's home), col 0 = file a.
  Cell values: 0 empty, ±1 man, ±2 king, positive = Light.
- Testability hooks for Playwright: squares are buttons with `data-square="b4"`; pieces have
  `data-testid="piece"`, `data-square`, `data-color="light|dark"`, `data-king`; status line has
  `data-testid="status"`; the nfikh message has `data-testid="nfikh-note"`. The board has
  `data-theme="classic|wood|green"`.
- No hints about which piece to move (no "must capture" rings): spotting captures, and missed
  ones to take by nfikh, is up to the player.
- Settings (mode, difficulty, colour, board pattern, sound/music, strict mode) persist to
  `localStorage`. An online seat (room code + token) is kept per tab in `sessionStorage`.
- Online: the server is the referee; the client plays its own action at once and sends it,
  plays the opponent's actions from `room:update` like computer moves, and snaps to the
  server's position whenever its copy is out of step (`RoomView.seq`).
