# Changelog

Chronological log of what we've done and decided in this project, across Claude Code
sessions. Newest entries at the top. See `PLAN.md` for what's next.

## 2026-10-24 (night)

Issue #38, branch `feature/online-server-metrics`: usage metrics for the online server.

- **Fly trial note first:** a game "disappearing after a while" turned out to be Fly's trial
  stopping the machine after 5 minutes (no card on the account yet). The user has since added
  a card.
- **`/metrics`** (prom-client, own registry): rooms created, games started/finished (+ result),
  moves by kind, refusals by reason, rejoins/failures, game duration + moves histograms,
  gauges read from `RoomManager.counts()` when scraped (open / waiting / active rooms,
  players connected, unique players today), and Node default metrics.
  - It's served on METRICS_PORT 9091, a separate HTTP server. Fly scrapes it via `[metrics]` in
    fly.toml; it isn't reachable from the internet.
- **`/stats` + `/stats.json`**, public: right-now and today counts, refreshing every 30 s, no
  codes, tokens or IDs.
- **Anonymous player ID:** `crypto.randomUUID()` once per browser in localStorage
  (`dama.player.v1`), sent on create/join/rejoin (an optional `playerId` in the protocol).
  - The server validates the format, keeps a per-UTC-day Set (capped at 100k) and never logs it.
- `RoomManager` now records `startedAt` and `finishedAt`, and `play()` reports a game that just
  finished (once), which the server logs as `game_finished`.
- `server/grafana-dashboard.json` to import into https://fly-metrics.net.
- The image was built and run locally: /stats.json and /metrics both answer, and it used about
  74 MB of memory idle.

## 2026-10-24 (evening)

Issue #36, branch `fix/online-reconnect-not-in-room`. On a phone, after a while: "You are not
in a room."

- **Cause:** socket.io-client sends the messages it queued while disconnected (`emitBuffered()`)
  *before* firing `connect`, which is where the app sent `room:rejoin`. A move made during a
  drop therefore reached the server on a connection that wasn't seated yet. Reproduced with
  scripted clients, and in Playwright with `context.setOffline()`.
- **A second way to lose a move:** an acknowledged emit that times out (5 s) is taken out of
  the client's send buffer. After a longer drop, the server never got the move, and the board
  snapped back on rejoin.
- **Fix:**
  - `room:action` carries the seat's code + token, and the server seats an unseated
    connection from it. Seating the same seat twice is a no-op; before, a rejoin on an
    already-seated socket marked the player disconnected.
  - The client stays "reconnecting" (moves blocked) until the rejoin reply. It keeps its last
    unconfirmed action and re-sends it if the rejoined position doesn't have it.
  - An unanswered request isn't shown as an error.
  - Errors clear once the game moves on, and a game the server no longer has shows as 'lost'.
  - Server heartbeat is now 10 s + 10 s (was the default 25 + 20 s): Chromium offline
    emulation showed neither side noticing a dead connection for over 12 s.
  - JSON event logs (no tokens).
  - Region docs updated: the server runs in `ams`, since Madrid wasn't available.
- **Issue #39, same PR:** closing Safari mid-game lost the seat (home screen on reopening, and
  "room is full" when joining the own room's code), because iPhone Safari empties a tab's
  sessionStorage when it's closed. Seats now live in localStorage (`SeatStore`: the current
  game to return to, plus every seat by code, forgotten after a day or once the room is gone).
  Joining a code you hold a seat in rejoins. Leave room keeps the seat but stops the automatic
  return. Clearer full-room message, and "lost connection N min ago" for the waiting player.
  Trade-off: all tabs of one browser are one player (local testing needs a private window,
  which the README already said). Two new e2e tests, both failing on the previous code.
- **Tests:**
  - Server: a move sent during a drop is accepted after reconnect (fails on the old code),
    a wrong token is refused, and logs carry no tokens.
  - Client: holds 'reconnecting' until the rejoin, 'lost', unreachable isn't an error, errors
    clear, re-send if missed, no double send.
  - e2e: black goes offline, moves, and comes back; white gets the move. Fails on master.

## 2026-10-24

Online rooms prototype, branch `feature/online-rooms-prototype` (local only, not hosted yet).
The polish round (#28 and its sub-issues) is parked until after this.

- **`server/`**: Node.js + Socket.IO, run with `tsx` (no build step). `RoomManager` (pure,
  unit tested) holds rooms in memory: 4-character codes without look-alike characters, a
  secret token per seat for rejoining, a 30-minute cleanup of empty rooms. Every action is
  checked with the engine imported straight from `web/src/engine`. The server runs as
  CommonJS because the engine files sit under `web/`, whose package.json isn't ESM: importing
  them from an ESM server failed on named exports.
- **Protocol** (`web/src/protocol/online.ts`): `room:create/join/rejoin/action/leave` with
  acknowledgements, and `room:update` with a per-player `RoomView` (state, `seq`, last action,
  whether the opponent has joined / is connected).
- **Client**: an Online mode on the home screen (create, with a colour choice, or join by
  code; `?room=` invite links fill the code in). GameService plays the player's own action at
  once and sends it, and plays the opponent's like a computer move, so it animates and makes
  its sound. If its copy is out of step (a missed update, a refused action) it snaps to the
  server's position. The seat is kept per tab in sessionStorage, so a reload rejoins and two
  tabs can be two players. The server URL is `<page host>:3000` unless `?server=` says
  otherwise, so a phone on the same Wi-Fi works.
- **Online only shows when the server is there**: the server answers `GET /health` (with a
  CORS header), and the app asks it each time the home screen is shown (2 s timeout,
  `checkOnlineServer()`; only the latest check's answer counts). The Online button is hidden
  until it answers; a saved "online" mode falls back to Vs computer meanwhile and comes back if
  the server turns up (unless the player picked something else). An invite link with no server
  says "Online games aren't available right now." So the live site, which has no server yet,
  shows no Online option, and the branch can be merged before hosting.
- **Hosting on Fly.io** (same branch): `server/Dockerfile` (two stages: an esbuild bundle of
  server + engine, then node:22-alpine with only Socket.IO), `fly.toml` at the repo root
  (Madrid, one machine, never auto-stopped, health check on /health, CORS_ORIGIN set to the
  GitHub Pages origin), `.github/workflows/deploy-server.yml` (tests on PRs; on master tests
  then `flyctl deploy --remote-only --ha=false`, skipped with a notice until FLY_API_TOKEN
  exists). Socket.IO's `cors` option doesn't stop WebSocket connections (browsers don't apply
  CORS to them), so the server also checks the Origin header in `allowRequest`. The app
  connects to `HOSTED_SERVER_URL` on https pages. The image was built and run locally:
  /health, a create/join/move round trip, and a refused foreign origin all checked out.
- Tests: 16 server tests (rooms, /health, allowed origins, real Socket.IO clients), GameService online spec with a
  fake client, wording tests, and `e2e/online.spec.ts` (two browser contexts through the real
  server; Playwright now starts the server too).

## 2026-10-21

Issue #21 (feature request), branch `feature/nfikh-home-screen-classic-board`:

- **Men capture forward only**, on every hop. Side effect: a man's capture that reaches the far
  row ends there and promotes (it can't jump on backwards), so the old "passes through the far
  row, stays a man" case can't happen any more — that test now checks promotion instead.
- **Captures are optional, with nfikh.** `generateLegalMoves` now returns captures *and* plain
  moves (strict mode only narrows the captures to the longest). `GameState.forfeitable` lists
  the pieces of the side that just moved that could have captured but didn't (computed in
  `advanceState` via `forfeitableAfter`); `takeForfeit` removes one, keeps the same side to
  move and clears the list. `outcome()` doesn't call a side lost while an nfikh would free a
  move. The AI now searches *turns* (`chooseTurn`: optional nfikh + move; nfikh doesn't
  change depth or side), and its quiescence search became a stand-pat search, since a capture
  being available no longer means it's forced. The worker protocol carries `forfeitable` and
  returns a `Turn`. In the UI, tapping a forfeitable enemy piece takes it (`TapResult`
  `'nfikh'`); the board fades it out (`updateKind` `'nfikh'`), and the computer pauses 600ms
  after an nfikh before moving so the player sees it. A note under the status line says what
  happened, until the other side moves.
- **No hints about which piece to move**: removed the pulsing "must capture" rings and the
  "You must capture" status text (they'd also have given missed captures away).
- **White and black pieces, classic board patterns**: plain discs with a pressed ring; board
  pattern (`Settings.boardTheme`: classic black & white (default), wood, green), set per board
  in `board.css`. The UI says White/Black; the code keeps LIGHT/DARK and `data-color`.
- **Home screen** (`src/app/home/`): opponent → difficulty and colour (vs computer) → board
  pattern → Start game. The game screen lost its mode/difficulty/colour buttons and gained a
  summary line and a Menu button. GameService no longer starts the computer from its
  constructor: a game only starts from the home screen.
- Rebased onto master after #19 (board coordinates), #20 (screen reader + keyboard play) and
  #23 (game-over card waits for the last move). Kept this branch's design, plus master's
  accessibility: square labels now say white/black and no longer say "must capture" (that
  would give the hint away again); move announcements name White/Black; the nfikh note is an
  always-present live region. Also fixed a bug of this branch's own: a selected piece that
  could both capture and move only showed one kind of marker (dots vs rings were decided by
  its first move).
- Tests: rule cases updated + new ones for forward-only captures; `nfikh.spec.ts` (engine and
  AI); controller, service, board and app specs for nfikh and the home screen; e2e specs go
  through the home screen (`e2e/start.ts`) and cover nfikh and the board pattern.

## 2026-10-18

- Read `dama-claude-code-prompt.md` (the original spec) and started building phase 1: a
  static (no-backend) Angular web app for Moroccan dama.
- **Node/Angular version decision:** the machine has Node 24.13.0. Angular 21 (which the
  original prompt asked for) requires Node ≥22.22.3, ≥24.15.0, or ≥26.0.0 — just above what's
  installed. Rather than upgrade Node system-wide (affects other projects on this machine),
  used **Angular 20.3** instead. It has every API the spec actually needs: standalone
  components, signals, zoneless change detection (`provideZonelessChangeDetection`), the new
  `@if`/`@for` control flow, and `inject()`. Revisit the Node upgrade later if we want 21+.
- Scaffolded the app in `web/` via `npx @angular/cli@20 new web --style=css --ssr=false`.
  Reconfigured it for the spec's intent: removed zone.js (polyfills + dependency), switched
  `app.config.ts` to `provideZonelessChangeDetection()`, and switched the `test` target in
  `angular.json` from the default Karma/Jasmine builder to Angular's experimental
  `@angular/build:unit-test` builder with `runner: "vitest"` — so `ng test` now runs Vitest
  against `src/app/**/*.spec.ts`, consistent with the engine's own Vitest tests.
- Added `vitest`, `jsdom`, and `@playwright/test` as dev dependencies; removed
  `zone.js`/`karma`/`jasmine`. Known tradeoff: `npm audit` reports vulnerabilities in
  `karma`'s transitive deps and in `vitest`'s `tinypool`/`@vitest/mocker` — these are
  dev/test-tooling-only (not shipped in the built static site) and tied to `@angular/build`'s
  pinned peer range (`vitest: ^3.1.1`, `karma: ^6.4.0`, both required even though we don't use
  Karma). Not fixed now; revisit when upgrading Angular.
- Built `web/src/engine/` — the pure TypeScript rules engine, no Angular imports:
  - `types.ts`, `board.ts` (100-cell `Int8Array`, square-name parsing/formatting, initial
    setup), `moves.ts` (legal move generation: men, kings, compulsory capture, mandatory
    multi-jump, strict-mode max-capture filtering, promotion only on final landing),
    `game.ts` (turn/outcome/draw-counter state machine), `ai.ts` (negamax + alpha-beta +
    quiescence search, 3 difficulty levels), `index.ts` (barrel export).
  - Coordinate system: board index = `row*10+col`; row 0 = rank 1 (Light's home row), col 0 =
    file `a`. Verified by hand against every row of the spec's rule table before coding.
- Wrote `web/src/engine/rules-cases.json` (all 12 positions from the spec's rule table) and
  `web/src/engine/rules.spec.ts` (those 12 cases, opening-position move count, promotion
  behaviour, `applyMove` purity/capture-removal, and a seeded 300-game fuzz test checking
  board invariants). Wrote `web/src/engine/ai.spec.ts` (every difficulty always returns a
  legal move or `null`; single-legal-move shortcut skips the RNG; a built "don't hang your
  last piece" position proves Novice/Very-good avoid the losing move, checked in both the
  position and its left-right mirror to rule out a direction-array asymmetry bug).
  **All 29 tests pass** (`npm run test:engine` from `web/`, config `vitest.engine.config.ts`).
- Created `CLAUDE.md` (repo root), `docs/ROADMAP.md`, `docs/RULES.md`, and this
  `claude/CHANGELOG.md` + `claude/PLAN.md`.
- `git init`'d the repo (it had none before).
- Built the rest of phase 1 on top of the engine, all in the same session:
  - **AI web worker** (`src/app/ai/`): `ai.worker.ts` runs `engine/ai.ts`'s `chooseMove` off
    the main thread; `ai-client.ts` wraps it with a main-thread fallback if the worker can't
    start, plus the ~450ms minimum "thinking" pause. Wired into the build via
    `tsconfig.worker.json` + `webWorkerTsConfig` in `angular.json` (esbuild bundles it as its
    own lazy chunk — confirmed in the build output).
  - **Game flow** (`src/app/game/`): `game-controller.ts` is a framework-free class owning
    engine state, tap-to-move selection (supports both tapping each landing square of a
    multi-jump and jumping straight to the final square), undo history (2 steps vs computer,
    1 in 1v1), and settings. `game.service.ts` wraps it in Angular signals via a `version`
    signal bumped on every mutation, and orchestrates the computer's turn — including the
    "computer opens as Light" case when the human picks Dark.
  - **Board component** (`src/app/board/`): presentational only — board/selection/highlight
    state in via inputs, a `squareTap` output. Renders only the 50 playable squares as
    buttons; flips 180° (both axes) when the human plays Dark so their own pieces sit at the
    bottom. Has the `data-square`/`data-testid="piece"`/`data-color`/`data-king` hooks the
    spec asked for.
  - **Styling**: Moroccan palette and Reem Kufi/Figtree (Google Fonts) as CSS custom
    properties in `styles.css`, with a `prefers-color-scheme: dark` override block. Bottle-cap
    pieces via a `repeating-conic-gradient` crimped rim + a radial-gradient domed centre; king
    pieces get an 8-point star (two squares overlapping at 45°) in saffron. Board maxes at
    560px, phone-first, no horizontal scroll. Landing dots, capture rings, a pulsing
    compulsory-capture ring, path-so-far and last-move highlighting are all driven by the
    inputs `App` computes from `GameService`.
  - **Sound** (`src/app/audio/`): `sound-engine.ts` synthesizes every effect (click, wooden
    move tap, heavier capture clack, a rising promotion chime, win/loss phrases) and a
    background loop — D Hijaz scale, a maqsum-pattern darbuka (doum/tek), a low D drone — via
    a look-ahead scheduler at 92 BPM. `audio.service.ts` is the Angular-facing wrapper;
    `GameService` plays effects via `effect()`s watching `lastMove`/`outcome`, while `App`
    calls `audio.unlock()` synchronously inside every click handler (required — browsers only
    allow `AudioContext` creation inside a real user-gesture call stack, and Angular's
    zoneless `effect()` callbacks run as a deferred microtask, too late to count as the
    gesture).
  - **Tests**: fixed a real bug caught by `ng test`'s full-project type-check (`ai.spec.ts`
    imported `Difficulty` from the wrong module). Added `App` component tests (40 pieces at
    start, "Your move." status) — needed `provideZonelessChangeDetection()` in the TestBed
    providers, since Angular's test bed doesn't inherit `app.config.ts`. Wrote 6 Playwright
    e2e tests (`web/e2e/`) covering the spec's listed scenarios (start position, 1v1
    alternation, illegal-target no-op, vs-computer reply, undo, Dark-opens) — **all 12 pass**
    (Desktop Chrome × Pixel 7). One early e2e bug: `[data-square="X"]` matched both the square
    button and the piece `<span>` inside it (both carry that attribute) — scoped taps to
    `button[data-square="X"]`.
  - Installed Playwright's Chromium (needed `dangerouslyDisableSandbox` for the download —
    the sandboxed Bash tool has no network egress to `cdn.playwright.dev`; this was an
    explicit, user-pre-approved, one-time tooling download, not a risky action).
  - Added `.gitlab-ci.yml` (engine tests → `ng test` → build → Playwright with JUnit report →
    manual Cloudflare Pages deploy on `main`) and a project-specific `web/README.md`.
  - Verified the whole thing manually by running the dev server and the full e2e suite
    against it (no browser-screenshot tool was available in this session to eyeball it
    directly — the Playwright run against a real headless Chromium is the verification).
  - Removed one piece of dead code (`app.ts` had an unused `rulesOpen` computed left over
    from an earlier draft — the Rules section uses a plain `<details>` instead).
- **AI reply timing tuned** at the user's request: `ai.ts`'s "very-good" iterative-deepening
  budget dropped from 1.5s to 300ms, and `AiClient`'s minimum-thinking-pause floor was restored
  (it had been removed at some point outside this session) at 200ms instead of the original
  450ms — applied as `max(actualTime, 200ms)`, not an added delay, so it only pads near-instant
  replies (Beginner) without slowing down Novice/Very-good.
- **Responsive two-column layout**, per the user's request ("use the width to your advantage
  — board on the left, options on the right"): `app.html`/`app.css` restructured into a
  `.board-column` + `.sidebar`, row layout from 680px wide. Then widened to also cover
  landscape phones specifically, since the width breakpoint alone missed narrower ones (an
  iPhone SE at 667×375 landscape stayed stacked) — added
  `(orientation: landscape) and (max-height: 520px)` as an OR condition, with flexible
  (not fixed-width) columns so it degrades gracefully. Then the user flagged the board itself
  was too small to tap comfortably in that mode: its size was clamped via a hardcoded
  `calc(100vh - 170px)` in `board.css`, calibrated for the old taller header — turned that into
  a CSS custom property (`--board-vh-reserve`) that the landscape media query overrides to
  118px (measured off real `getBoundingClientRect()` output in a browser, not guessed),
  growing the board from ~205px to 242–294px per side across tested viewports with 12–13px to
  spare (no clipping). Verified all of this with Playwright screenshots and direct DOM
  measurements at 5+ viewport sizes, not just by reasoning about the CSS.
- **Piece-slide animation, including captures** (user: "show that the tile goes over the
  other one... should be natural and the user should not be confused about what tile is
  lost"). The engine only exposes flat `Int8Array` board snapshots with no piece identity, so
  added a small reconciliation layer inside `Board`: it tracks pieces by a stable id, and
  `GameService` now tags every update as `'move'` (play `lastMove.path` hop by hop, animating
  each landing square) or `'reset'` (new game/undo — snap instantly, no history to animate
  from). A captured piece is marked `.captured` (CSS fade + shrink) at the exact moment the
  capturing piece's hop toward it starts, so the two transitions run concurrently and the
  piece visibly disappears as the capturer passes over it — multi-jumps repeat this hop by
  hop automatically since `lastMove` already lists every landing square and every captured
  piece in order. Pieces moved out of the square buttons into their own absolutely-positioned
  layer (`pointer-events: none`) so one DOM element can slide between squares instead of being
  destroyed and recreated. Respects `prefers-reduced-motion`; guards overlapping animations
  (e.g. Undo mid-slide) with a token check.
  **Bug hit and fixed**: the reconciliation `effect()` read `board()`/`updateKind()`/
  `lastMove()` but `reconcile()` also read-then-wrote the `pieceStates` signal it's driven
  by, synchronously, before any `await` — Angular's effect dependency tracking picked that up
  as a self-dependency, so the write re-dirtied the effect and it kept re-triggering itself.
  No thrown error, just a livelock: the page froze (unresponsive, but the HTTP server kept
  serving fine) on the very first real move. Found it by bisecting with a Playwright script
  that captured console/page errors and timings, not by guessing; fixed by wrapping the
  `reconcile()` call in `untracked()`. Verified correct with a quantitative check (piece count
  40 → still 40 at 80ms into a capture hop → 39 at 600ms, i.e. the captured piece stays
  visible through the hop and is removed right after its fade completes), not just a visual
  screenshot.
- Also: cleared up a mid-session mix-up where the user asked why the site "still wasn't
  loading" — there was never a server left running for them to check (I'd been starting and
  killing temporary `ng serve` instances for my own testing each time, and screenshots were
  temp files I viewed myself, not shared). Lesson for future sessions: when verification
  implies the user should be able to look at something themselves, leave a server running and
  say the URL explicitly, rather than only reporting "I verified it."
- **Per-situation capture sounds**, at the user's request: distinguished simple moves,
  single/double/triple captures, king captures, and "a king was just captured" (framed as
  triumphant vs ominous depending on whose king it was, in vs-computer mode only — no
  "yours/theirs" distinction makes sense in 1v1). Required teaching the engine something it
  didn't track before: `Move` only recorded *which squares* were captured, not *what was on
  them*, so a king-capture couldn't be told apart from a regular one. Added a `capturedKing:
  boolean` field to `Move`, computed in `moves.ts`'s capture search, with 4 new engine tests
  (including a king captured mid-multi-jump, not just on the first hop) — 33/33 engine tests
  green. `GameService.announceMove()` now picks the sound(s) per move based on
  `captures.length`, whether the mover is a king, and `capturedKing`.
  **Follow-up**: the user flagged the capture sound was too similar to the plain move tap —
  both were the same `woodTap` function, just scaled by intensity (louder/higher pitch), which
  isn't perceptually distinct enough. Replaced the capture sound with a genuinely different
  timbre: a short filtered noise "crack" (the impact) layered over a punchier square-wave thud
  (triangle wave felt softer than square), instead of a louder version of the same triangle
  wave. Verified live (not just by reading the code) by auto-playing real captures against a
  running dev server and checking for runtime errors, and by directly exercising the new
  oscillator/noise patterns against a real browser `AudioContext`, since jsdom (what `ng test`
  uses) has no Web Audio implementation to catch this kind of bug.
- **GitHub Actions deploy to GitHub Pages**: `.github/workflows/deploy.yml`, builds and
  deploys on every push to `master` touching `web/` (plus manual `workflow_dispatch`).
  Discovered along the way that this repo already has a GitHub remote
  (`github.com/Shinwi/Dama`, `master`, already in sync with local) — hadn't been mentioned
  before this. Used `actions/configure-pages` to read the real Pages base path at build time
  (`--base-href`) rather than hardcoding `/Dama/`, so it keeps working if the repo is ever
  renamed or forked. **Needs a one-time manual step the user has to do themselves**: repo →
  Settings → Pages → Source → "GitHub Actions" — no API access to flip that setting from here.
  Verified the build step for real: ran `ng build --base-href "/Dama/"` locally and confirmed
  `index.html` got the right `<base href>` — first attempt showed `<base
  href="C:/Program Files/Git/Dama/">`, which looked alarming, but turned out to be Git Bash's
  MSYS path-mangling auto-converting the leading-slash argument (a Windows-local quirk,
  confirmed by rerunning with `MSYS_NO_PATHCONV=1` and getting the correct `/Dama/` — GitHub's
  actual Linux runners won't hit this at all).
- User confirmed the GitHub Pages deploy is live and working, then reported a gameplay bug:
  sometimes after capturing one piece of a multi-jump, the second capture isn't playable and
  the piece looks "blocked". Checked `gh api repos/Shinwi/Dama/issues` — no open or closed
  issues on the repo (no `gh` CLI installed locally, used the public REST API directly via
  `curl`).
  **Investigation**: `GameController` — the class that turns a sequence of taps into engine
  moves, including stepping through a multi-jump square by square — had **zero test
  coverage**, despite being the most likely place for a bug like this to hide (it's the most
  bespoke, least-exercised-by-the-engine's-own-tests code in the project). Added
  `game-controller.spec.ts`: stepwise tapping through a real two-hop capture
  (`c3xe5xg7`, from `rules-cases.json`), tapping straight to the final square, a deliberately
  wrong tap mid-sequence, two independently-capturing pieces in the same position, and strict
  mode. **All 5 passed on the first run** — the tap-sequencing logic itself is correct.
  That points at one of two explanations instead of a logic bug: (a) the position actually had
  two *separate* pieces that could each capture independently (not one piece chaining two
  jumps) — the user played one, which is a complete legal move and ends the turn, and the
  *other* piece naturally can't also move since it's the opponent's turn now; this is correct
  dama rules (one piece moves per turn, even under compulsory capture) but can look exactly
  like "I could eat two, ate one, the other's stuck". Or (b) it genuinely was one piece's
  multi-jump, and a slightly mistaken second tap (wrong square) silently did nothing — the
  `game-controller.spec.ts` "mistaken tap mid-sequence" test confirms this is exactly what
  happens by design: an invalid tap during a forced continuation is a silent no-op with no
  sound or visual feedback, so it reads as "the piece is stuck" even though the engine is
  still correctly waiting for the real continuation. Couldn't narrow it further without the
  user's exact position — noted as the next thing to pin down in `PLAN.md`, along with "add
  feedback on an invalid tap" as a worthwhile UX fix regardless of which explanation it was.
- **Capture bug found and fixed** (follow-up to the report above). Reproduced it in a new
  `board.spec.ts`: the engine and `GameController` were right all along, but the **board's
  animation layer** went out of sync with them. `Board.reconcile()` cancels a running
  hop-by-hop slide (via `animationToken`) as soon as the next move arrives, without ever
  finishing it, and the computer's reply arrives after `MIN_THINK_MS` = 200ms while each
  capture hop takes 210ms. So in vs-computer mode, a 2+ hop capture was often cut short
  after its first hop: the piece stayed drawn on the first landing square, the later
  captured men stayed drawn, and tapping the piece did nothing, because in the engine it
  was already on its real final square. It stayed wrong until Undo/New game. Fix: an
  interrupted animation now snaps to the board it was heading for before the next move is
  animated. While fuzzing `tapSquare` (every legal move in 15k random positions, played by
  tapping its path) I also found a second, rarer bug: the "tap straight to the final
  square" shortcut was checked before the next-hop match, so with king loops (j2xg5x…xe7 vs
  j2xe7x…xg5) tapping a first hop could commit a different sequence that happened to end
  there. The next hop now takes priority. Regression tests were added for both bugs. The
  fix is tracked as GitHub issue #1.
  **Second round**: the user tested the PR preview and still hit it with a 3+ man chain.
  The animation fix held up in a browser fuzz (random 3+ capture chains vs the computer,
  drawn board compared to the engine after every move: no mismatches), so I looked at what
  the board shows mid-chain instead. Until the last hop is tapped nothing has been played,
  so the piece stayed drawn on its starting square and the men it had jumped stayed drawn.
  The only feedback was a thin outline on the landing square. That *is* "stuck after eating
  the first man": tapping the piece does nothing, and the chain only continues from a small
  ring on an empty square. Board now draws the in-progress jump (piece on the square it has
  reached, jumped men fading out), and the final slide picks up from there.
  **Third round**: the user found the preview too fast, then (after a slowdown) too slow,
  and laid out the flow they wanted: tap the piece, tap where it ends up, animate it
  through the whole route, check it has landed, and only then let the other side move.
  That's what it does now. A move is two taps: selecting a piece marks the squares its moves
  *end* on, not the next hop. Only when two capture routes end on the same square does the
  player pick one, by tapping where the routes split. Speed is back to 170/210ms per hop.
  `Board` emits `settled` once a move has played out, and `GameService` holds everything
  until then (`moving`): the computer only starts thinking after the player's piece has
  landed, and taps are ignored meanwhile. A 5s timeout covers the board never reporting.
  Checked by playing all 122k legal moves of 15k random positions with the two-tap flow,
  plus a browser fuzz that the computer's piece never moves before the player's lands.
- **Game-over overlay**: win/loss/draw previously only changed the status line's text, easy to
  miss, with no dedicated "the game has ended" visual moment. Added `describeGameOver()` — a
  pure function (`app.ts`), not just inline template logic, specifically so it's unit-testable
  without having to actually play a game to completion through the UI (5 new tests: ongoing →
  null, draw, vs-computer win/loss framed as "you", 1v1 framed by side name) — and a card
  overlay on top of the board (dimmed backdrop, result title in saffron/muted depending on
  win/loss, one-line reason, "New game" button), shown via `App`'s `gameOver` computed.
  Verified the actual rendered CSS (not just the logic) by injecting a forced win state into
  a live page — first attempt looked broken (unstyled, no overlay positioning) because
  Angular's emulated view encapsulation only applies component CSS to elements carrying its
  auto-generated `_ngcontent-*` attribute, which `document.createElement` nodes don't have;
  copied the real attribute off an existing Angular-rendered element to fix the check. Second
  issue chasing a "translucent card" look turned out to just be the entrance animation
  (`opacity`/`scale` over 220ms) caught mid-transition in the screenshot — confirmed by
  checking computed styles directly (solid white, opacity 1) and by waiting past the
  animation before re-screenshotting.
