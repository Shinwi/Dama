# Plan — phase 1 (static vs-computer + 1v1 game)

Living document. Update this as steps finish or the approach changes; keep `CHANGELOG.md` as
the historical record of what actually happened and why.

## Done

1. ✅ Project docs (`CLAUDE.md`, `docs/ROADMAP.md`, `docs/RULES.md`, this folder).
2. ✅ Angular 20 app scaffolded in `web/`, zoneless, Vitest wired in for both engine and
   component tests.
3. ✅ Engine: board, move generation (men, kings, compulsory capture, multi-jump, strict
   mode, promotion), game/outcome state machine, `rules-cases.json` + tests, 300-game fuzz
   test. All green.
4. ✅ AI: negamax/alpha-beta/quiescence, 3 difficulty levels, tests (legality, null-on-no-
   moves, single-move shortcut, "doesn't hang its last piece" + mirror).

## Next, in order

5. **AI web worker.** `src/app/ai/` — a worker entry that calls `engine/ai.ts`'s
   `chooseMove`, and an `AiClient`/service wrapping it with signals, falling back to running
   on the main thread if the worker fails to start. Add the ~450ms minimum "thinking" pause
   here (not in the engine).
6. **GameService** (`src/app/game/`) — signals-based: board state, selected square / move-in-
   progress, legal-move highlighting, turn, undo stack (vs computer: undoes the player's move
   *and* the computer's reply as one step; 1v1: undoes one move), new game, settings
   (mode/difficulty/colour/sound/music/strict — persisted to `localStorage`). Framework-free
   controller underneath so logic stays out of components.
7. **Board component** (`src/app/board/`) — renders the 100 cells (only playable squares get
   buttons), pieces with stable ids for animation, tap-to-select/tap-to-move interaction,
   data-testid/data-square/data-color/data-king hooks for Playwright. At this point the game
   is playable end to end (1v1 and vs computer), just unstyled.
8. **Styling pass** — Moroccan colour palette and fonts (Reem Kufi / Figtree, Google Fonts),
   bottle-cap piece rendering (conic-gradient crimped edge + domed centre), king star,
   light/dark mode via `prefers-color-scheme`, phone-first responsive layout (360px up, board
   maxing around 560px on desktop, no horizontal scroll), board orientation flip when playing
   Dark, status line, collapsible Rules section with the strict-mode toggle inside it.
9. **Animation** — CSS slide transitions per hop (~170ms move / ~210ms capture), respecting
   `prefers-reduced-motion`.
10. **Sound** (`src/app/audio/`) — Web Audio synthesis for click/tap/clack/promotion/win/loss,
    plus the generated Hijaz-on-D background loop with darbuka rhythm and drone. Starts only
    after a user gesture; pauses on tab-hidden.
11. **Component tests** via `ng test` (App renders 40 pieces at start, status text).
12. **Playwright e2e** (`web/e2e/`) — desktop Chrome + Pixel 7 projects; the scenarios listed
    in the original spec (start position, 1v1 alternation, illegal-target no-op, vs-computer
    reply, undo, playing Dark opens with the computer).
13. **CI + deploy** — `.gitlab-ci.yml` (engine tests → `ng test` → build → Playwright →
    optional Cloudflare Pages deploy on `main`), README with local commands and the Cloudflare
    Pages deploy steps (publish `web/dist/web/browser`).

## Open items / decisions to revisit

- **Angular version**: on Angular 20, not 21, because of the Node version on this machine
  (see `CHANGELOG.md`, 2026-10-18). Upgrade Node and re-run `ng update` when convenient.
- **npm audit** flags dev-tooling-only vulnerabilities from `@angular/build`'s pinned
  `karma`/`vitest` peer ranges. Not a shipped-code risk; revisit on the next Angular upgrade.
- Phase 1 stays fully static/offline per the original spec — no server, accounts, or rooms
  yet. Phase 3 (`docs/ROADMAP.md`) is where online rooms come in, once this phase has been
  played by real people and feels right.
