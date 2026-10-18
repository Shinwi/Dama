# Changelog

Chronological log of what we've done and decided in this project, across Claude Code
sessions. Newest entries at the top. See `PLAN.md` for what's next.

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
