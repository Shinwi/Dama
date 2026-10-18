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
