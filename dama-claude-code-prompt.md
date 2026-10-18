I want to build **Dama**, a browser game of **Moroccan checkers**. I'm a QA test automation engineer (Java, Selenium, GitLab CI) and I'm using this project to **learn Angular, Playwright and Node.js**. Build it with me step by step, and briefly explain the important Angular concepts as you use them (2–3 sentences each, not tutorials).

Before writing code: read this whole prompt, then create the project docs described in "Files to create first", show me your step plan, and wait for my OK.

---

## What we build NOW (phase 1 only)

A **static Angular web app, no backend**, where I can:

1. **Play against the computer** with a difficulty choice: **Beginner**, **Novice**, **Very good**. I can choose to play **Light** or **Dark** (when I play Dark, the computer opens).
2. **Play 1v1 on the same device** (pass-and-play) with someone next to me.
3. **Undo** (vs computer: takes back my move and the computer's reply; 1v1: one move) and **New game**.
4. Toggle **sound effects** and **background music**.
5. Toggle an optional **strict mode** rule (see rules).

Settings (mode, difficulty, colour, sound) are remembered in localStorage.

Do **not** build anything online yet: no server, no accounts, no rooms. But keep the architecture ready for it (see "Architecture").

---

## Game rules (Moroccan dama), implement exactly

- **Board:** 10×10, only the dark squares are used ((row + col) is odd). **20 pieces each**, on the dark squares of the 4 rows nearest each player. **Light moves first.**
- **Men** move **one square diagonally forward**.
- **Capturing is compulsory.** If any capture exists, only captures are legal.
- **Men capture forwards and backwards** by jumping an adjacent enemy piece onto the empty square right behind it.
- **Multi-jumps:** after a capture, the same piece **must keep jumping** while it can. A move is the complete sequence.
- **Jumped pieces stay on the board until the move ends**: they block the path and **can't be jumped twice**. They are removed all at once at the end.
- **Promotion:** a man that **ends its move** on the far row becomes a **king**. A man only passing through the far row mid-capture stays a man and continues.
- **Kings fly:** they move any distance along a clear diagonal, and capture an enemy piece any distance away on a diagonal (only empty squares between), landing on **any empty square beyond it**. Kings can't jump two pieces in a row or their own pieces.
- **Choice of captures:** by default the player may choose **any** capture sequence. **Strict mode (optional toggle, off by default):** the player must choose a sequence that captures the **most** pieces.
- **Game end:** a player who **cannot move** (no pieces, or all blocked) **loses**. **Draw** after **50 consecutive moves with no capture and no man moving**.
- Not now: *nfakh* (removing an opponent's piece that failed to capture). Planned for phase 2. Keep the engine flexible enough to add it.

Square names (for tests and notation) are from Light's view: files **a–j** left to right, ranks **1–10** bottom to top. Notation: `e5-f6` for a move, `c3xe5xg7` for a capture (every landing square).

### Rule test cases (put these in `rules-cases.json`, must all pass)
Each case is a position, side to move, and the exact sorted set of legal moves:

| Position | To move | Expected legal moves |
|---|---|---|
| light man e5 | Light | e5-d6, e5-f6 |
| dark man e5 | Dark | e5-d4, e5-f4 |
| light men e5, a1; dark f6 | Light | e5xg7 (capture is compulsory) |
| light e5; dark d4 | Light | e5xc3 (men capture backwards) |
| light c3; dark d4, f6 | Light | c3xe5xg7 (must keep jumping) |
| light d8; dark e9, g9 | Light | d8xf10xh8 (passes far row, stays a man) |
| light king a1 | Light | a1-b2 … a1-j10 (9 moves) |
| light king a1; dark e5 | Light | a1xf6, a1xg7, a1xh8, a1xi9, a1xj10 |
| light king a1; dark e5, f6 | Light | a1-b2, a1-c3, a1-d4 (can't jump two in a row) |
| light king a1, light man c3; dark h8 | Light | a1-b2, c3-b4, c3-d4 |
| light c3, g1; dark d4, f6, h2 (strict off) | Light | c3xe5xg7, g1xi3 |
| same, strict on | Light | c3xe5xg7 |
| light a9; dark b10 | Light | none (blocked) |

Also test: the opening position gives each side 9 moves; promotion only when ending on the far row (light lands on rank 10, dark on rank 1); applyMove removes all captured pieces and doesn't mutate its input; and a **seeded random-games test** (e.g. 300 games) checking invariants every move (pieces only on dark squares, pieces lost = captures, never the same piece captured twice).

---

## Computer opponent (AI)

- Negamax with alpha-beta. **Quiescence:** at depth 0 keep searching while a capture is forced, so it never stops mid-exchange.
- Evaluation from Light's view: man ≈ 100, king ≈ 330, small bonuses for advancement, back-row guard and centre control.
- Levels:
  - **Beginner:** ~35% random legal move, otherwise a 1-ply search with large random noise.
  - **Novice:** 3-ply search with small noise.
  - **Very good:** iterative deepening within a time budget (~1.5 s), best-first move ordering.
- If only one legal move exists, play it immediately.
- **Runs in a Web Worker** (use `ng generate web-worker`) so the page never freezes; fall back to the main thread if the worker fails.
- Add a short minimum "thinking" pause (~450 ms) so replies don't feel instant and robotic.
- AI tests: every level always returns a legal move; returns null with no moves; Novice and Very good don't hand over their last piece (test a position and its mirror, so it can't pass by luck).

---

## Look and feel

Moroccan identity, clean and modern, not kitsch:

- **Colours:** Majorelle blue accent (#4a3fc4 light / #8a80ff dark), saffron highlights (#e0a21c), cedar-wood board (light squares #ecdcbc, dark squares #8c5b3c, frame #5a3622).
- **Pieces look like bottle caps**, as used on street boards: a crimped edge (repeating conic gradient) with a domed centre. Light caps cream, dark caps deep blue. **Kings** show an 8-point star (two overlapping squares, rotated 45°) in saffron.
- **Fonts (Google Fonts):** "Reem Kufi" for the title, "Figtree" for text. Title: **Dama** with **ضامة** next to it.
- **Light and dark mode** via `prefers-color-scheme`, all colours as CSS custom properties.
- **Phone-first**, works from 360 px wide up; the board is the hero, max ~560 px wide on desktop. No horizontal scrolling.
- **Board orientation:** your own pieces at the bottom (vs computer playing Dark = board flipped). In 1v1, Light at the bottom.
- **Interaction:** tap a piece, then tap where it lands. For multi-jumps, tap each landing square or just the final one. Show: possible landing dots, capture landings as rings, the path tapped so far, last move highlighted, and when a capture is compulsory, ring the pieces that can capture.
- **Animation:** pieces **slide** along each hop of a move (~170 ms per hop, ~210 ms per capture hop) instead of jumping. Pieces need stable ids so Angular tracks them. Respect `prefers-reduced-motion`.
- **Status line:** "Your move." / "Computer is thinking…" / "Light to move." / "You must capture" / win, loss and draw messages. Piece counts per side with a turn marker.
- A collapsible **Rules** section on the page, and the strict-mode toggle inside it.
- No UI component libraries (no Angular Material); hand-made components and CSS.

### Sound (Web Audio, synthesized, no audio files)
- Effects: soft click on select, wooden tap per move hop, heavier clack per capture, rising chime on promotion, short phrases for win and loss.
- **Background music** (off by default, toggle): a generated loop in **maqam Hijaz on D** with a plucked oud-like voice, a **maqsum** darbuka rhythm (doum/tek) and a low D drone, at ~92 BPM, using a look-ahead scheduler.
- Audio starts only after a user click (browser rule) and pauses while the tab is hidden.

---

## Tech stack (now)

- **Angular (latest, 21+)** created with the Angular CLI: standalone components, **signals** (`signal`, `computed`, `input()`, `output()`), **OnPush**, zoneless, new control flow (`@if`, `@for` with `track`), `inject()`. No NgModules.
- **TypeScript strict**.
- **Vitest** for unit tests (engine with plain `vitest run`; components with `ng test`).
- **Playwright** for end-to-end tests, two projects: desktop Chrome and a phone (Pixel 7).
- **Node.js 22 LTS**.
- **GitLab CI** and **Cloudflare Pages** hosting (static).

## Architecture

```
dama/
  CLAUDE.md            project context for Claude Code (summary of this prompt)
  docs/
    ROADMAP.md         phases below
    RULES.md           the rules above, in plain language
  web/                 the Angular app
    src/engine/        PURE TypeScript rules + AI. No Angular imports. Fully unit tested.
                       Includes rules-cases.json. Will move to shared/ in phase 3 so the
                       Node server reuses it, and a Java backend can run the same JSON cases.
    src/app/game/      game flow (selection, animation steps, computer turns, undo) as a
                       framework-free controller + an Angular service exposing signals
    src/app/board/     board component: data in via inputs, square taps out via an output
    src/app/ai/        web worker + client
    src/app/audio/     sound engine
    e2e/               Playwright tests
  .gitlab-ci.yml
```

- Keep game logic out of components. Components only render and forward clicks.
- Board as a 100-cell `Int8Array` (0 empty, ±1 man, ±2 king; + = Light).
- **Testability hooks** for Playwright: board squares are buttons with `data-square="b4"`; pieces have `data-testid="piece"`, `data-square`, `data-color="light|dark"`, `data-king`; the status line has `data-testid="status"`. Use accessible roles and labels too (segmented controls as `role="group"` with `aria-label`, `aria-pressed` on options).

## Tests I expect
- Engine: all of the above, run with `npm run test:engine`.
- One or two Angular component tests (App renders 40 pieces, status says "Your move.").
- Playwright e2e: start position (20 + 20 pieces); 1v1 turns alternate (b4→a5, then c7→d6); an illegal target does nothing; vs computer (Beginner) it replies, and Undo restores the start; playing Dark makes the computer open. Status assertions after a computer move must allow extra text ("Your move. You must capture…").
- CI: engine tests → `ng test` → build → Playwright (JUnit report) → optional Cloudflare deploy on `main`.

---

## Roadmap: write this into `docs/ROADMAP.md`

Assume ~6–8 hours per week. Start a phase only after the previous one is deployed and real people have played it.

| # | Phase | Start when | Time | Tools |
|---|---|---|---|---|
| 1 | **Offline game:** vs computer (3 levels), 1v1 same device, undo, sound/music, deployed | Now | 3–4 weeks | Angular, Vitest, Playwright, Cloudflare Pages |
| 2 | **Polish & offline:** *nfakh* option, move list, installable PWA | Friends played phase 1, rules feel right | 1–2 weeks | `ng add @angular/pwa` |
| 3 | **Online rooms with friends:** create room → share code → friend joins → live play, reconnect | Phase 2 stable | 3–4 weeks | Node.js + TypeScript, Socket.IO (or Colyseus), shared engine validates every move, `shared/protocol.md` for WebSocket messages, Docker, Fly.io/Render/Railway in an EU region, always-on |
| 4 | **Random opponent:** matchmaking queue, move clocks, resign/draw | Rooms reliable | 2–3 weeks | Same server; in-memory queue, Redis only if >1 instance |
| 5 | **Accounts:** optional login, game history, Elo | Players want progress saved | 3–4 weeks | PostgreSQL, Prisma or Drizzle, Google login |
| 6 | **Tournaments:** brackets, scheduled rounds, leaderboard | Regular player group | 4–6 weeks | Postgres, scheduled jobs |
| S | **Spring Boot backend (learning track):** a second backend with the same protocol | After phase 3 works | 4–6 weeks | Spring Boot 3, Java 21, Spring WebSocket, Java engine port passing `rules-cases.json`, JUnit 5; later JPA, Flyway, Spring Security, Testcontainers |

Principles for later phases:
- The server validates every move with the shared engine (anti-cheat), but the client shows its own move instantly (no waiting on the network).
- Repo becomes `web/`, `server/`, `shared/`, later `server-spring/`; the same Playwright suite runs against either backend.
- Speed and smoothness are a priority: EU hosting, WebSockets, AI off the main thread, PWA caching.

---

## Files to create first
1. `CLAUDE.md` at the repo root: a concise summary of this prompt (game, rules, current phase, stack, architecture, conventions, test hooks) so future sessions have the context.
2. `docs/ROADMAP.md`: the roadmap table and principles above, with phase 1 marked as current.
3. `docs/RULES.md`: the rules in plain language plus the notation.

## Suggested build order (confirm with me first)
1. Create the Angular app in `web/` (`npx @angular/cli@latest new web --style=css --ssr=false`), add Vitest/Playwright setup and npm scripts.
2. Engine + tests (rules-cases.json first, then the implementation until green).
3. AI + tests + web worker.
4. Board component and game service: 1v1 on one device fully playable.
5. Computer mode, difficulty and colour choice, undo, settings persistence.
6. Animations, highlights, status line, styling, dark mode, phone layout.
7. Sound and music.
8. Playwright e2e + component tests.
9. `.gitlab-ci.yml`, README with commands and Cloudflare Pages deploy steps (output `web/dist/web/browser`).

After each step: run the relevant tests, tell me what changed and what to look at in the browser, and keep commits small with clear messages.
