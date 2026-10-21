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
5. ✅ AI web worker (`src/app/ai/`), with main-thread fallback and the ~450ms thinking pause.
6. ✅ `GameController` (framework-free) + `GameService` (signals): selection/tap-to-move
   (including partial multi-jump taps), undo, new game, settings persisted to `localStorage`.
7. ✅ `Board` component: presentational, inputs in / `squareTap` output, 180°-flip when
   playing Dark, all the Playwright test hooks.
8. ✅ Styling: Moroccan palette + Reem Kufi/Figtree, bottle-cap pieces, king star, light/dark
   mode, phone-first responsive board (≤560px, no horizontal scroll), status line, piece
   counts, collapsible Rules section with the strict-mode toggle.
9. ✅ Sound (`src/app/audio/`): synthesized effects + the Hijaz/darbuka/drone background loop,
   unlocked on the first click, paused on tab-hidden.
10. ✅ Component tests (`ng test`: 40 pieces, "Your move." status) and 6 Playwright e2e specs
    (12 runs across Desktop Chrome + Pixel 7) covering every scenario the original spec
    listed. `.gitlab-ci.yml` and `web/README.md` written.
11. ✅ Manually verified by running the dev server + the full Playwright suite against it end
    to end (1v1 play, vs-computer play with a reply, undo, Dark-opens all work in a real
    browser).
12. ✅ Responsive two-column layout: board + status in a left column, settings in a right
    sidebar, on desktop, tablets, and phones turned sideways (landscape phones matched by
    short height, not just width, so a narrower phone like an iPhone SE still gets it). Board
    also widened in landscape mode — its size was being clamped far smaller than the screen
    actually allowed.
13. ✅ Piece-slide animation, including captures. `Board` now tracks pieces by a stable id
    across renders (the engine's board is just an `Int8Array` snapshot with no identity of
    its own, so this lives in `Board`, driven by `GameService.updateKind()` — `'move'` replays
    `lastMove.path` hop by hop; `'reset'`, i.e. new game/undo, snaps instantly, no animation).
    A captured piece fades out at the same moment the capturing piece's hop passes over it
    (both hop and fade run concurrently on CSS transitions), so a multi-jump reads as the
    piece hopping over each piece it eats in turn. Respects `prefers-reduced-motion`; guards
    against overlapping animations (e.g. Undo clicked mid-slide) with a token check.
    Hit one real bug building this: the reconciliation `effect()` read and wrote the same
    signal, which made it re-trigger itself forever (froze the page on the first real move,
    no console error — just a livelock). Fixed with `untracked()`.
14. ✅ Per-situation capture sounds (count, king involvement) and a distinct capture timbre —
    see `CHANGELOG.md` for the detail, including the engine's new `Move.capturedKing` field.
15. ✅ Deployed to GitHub Pages via `.github/workflows/deploy.yml` — live and confirmed working
    by the user. Phase 1's "deployed, real people played it" condition is met.
16. ✅ Game-over overlay. Previously a win/loss/draw only changed the status line's text —
    easy to miss. Added `describeGameOver()` (pure function in `app.ts`, exported and unit
    tested on its own — win/loss/draw text, vs-computer "you" framing vs 1v1 naming the side)
    and a card overlay on top of the board (dimmed backdrop, result title, one-line reason,
    "New game" button), driven by it.
17. ✅ Closed a real test-coverage gap found while investigating a user bug report:
    `GameController` (the tap-by-tap multi-jump selection logic) had zero tests. Added
    `game-controller.spec.ts` — stepwise multi-jump tapping, tap-straight-to-the-end,
    a mistaken tap mid-sequence, two independently-capturing pieces, strict mode. All passed
    first try — see `CHANGELOG.md` for what this means for the bug report itself.

Phase 1 is functionally complete, animated, responsive, deployed, and all tests are green.

## Next, in order

18. ✅ **Capture bug** — found and fixed: the board animation was cut short when the
    computer replied mid multi-jump (see `CHANGELOG.md`), plus a king-loop tap-sequencing
    bug found along the way. Still worth doing: a sound/visual cue on an invalid tap during
    a forced continuation, instead of silence.
19. **Try it for real, more** — now that it's deployed, keep playing it (phone + desktop,
    both colours, both modes, sound/music on) and note anything else that feels off, the way
    the capture bug above got found.
20. Once friends have played it and the rules feel right: phase 2 from `docs/ROADMAP.md`
    (*nfakh*, a move list, installable PWA).

## Experiments

- **3D board** (`expiremental/3d-dama`, issue #25): playable end to end, behind a 2D/3D
  switch, with full screen. Bug-hunted by 10 scripted games (see CHANGELOG). To try next: play
  it on a real phone GPU (only software rendering has been tested), and decide whether it
  graduates to `master`.

## Open items / decisions to revisit

- **Angular version**: on Angular 20, not 21, because of the Node version on this machine
  (see `CHANGELOG.md`, 2026-10-18). Upgrade Node and re-run `ng update` when convenient.
- **npm audit** flags dev-tooling-only vulnerabilities from `@angular/build`'s pinned
  `karma`/`vitest` peer ranges. Not a shipped-code risk; revisit on the next Angular upgrade.
- **`ng test` builder is experimental** (`@angular/build:unit-test`, logs its own warning on
  every run). Works fine so far; if a future Angular upgrade breaks it, Karma is the fallback
  (would mean reintroducing zone.js for tests only, or waiting for the builder to stabilize).
- No real device testing yet (Playwright's Pixel 7 *emulation* passes, but that's viewport +
  UA, not a real phone/touchscreen) — see step 13 above.
- Phase 1 stays fully static/offline per the original spec — no server, accounts, or rooms
  yet. Phase 3 (`docs/ROADMAP.md`) is where online rooms come in, once this phase has been
  played by real people and feels right.
