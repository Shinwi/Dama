# Dama — web app

Moroccan checkers, phase 1: a static Angular SPA (vs computer + local 1v1), no backend. See
the repo root `CLAUDE.md` for project context, `docs/RULES.md` for the rules, and
`claude/PLAN.md` for what's next.

## Commands

```bash
npm install

npm start              # dev server at http://localhost:4200
npm run build          # production build -> dist/web/browser

npm run test:engine    # pure rules/AI engine tests (Vitest)
npm test               # Angular component tests (ng test, Vitest runner)
npm run e2e            # Playwright e2e (starts its own dev server on :4300)
```

## Project layout

- `src/engine/` — pure TypeScript rules engine and AI. No Angular. `npm run test:engine`.
- `src/app/game/` — framework-free `GameController` + the signals-based `GameService` that
  wraps it and orchestrates the computer's turn.
- `src/app/board/` — the board component (presentational: data in via inputs, taps out via
  an output).
- `src/app/ai/` — the AI web worker and its client, with a main-thread fallback.
- `src/app/audio/` — synthesized sound effects and background music (Web Audio, no files).
- `e2e/` — Playwright tests, run against Desktop Chrome and a Pixel 7 profile.

## Deploying to Cloudflare Pages

1. Build: `npm run build`. Output is `dist/web/browser`.
2. `npx wrangler pages deploy dist/web/browser --project-name=dama`, or connect the Git repo
   in the Cloudflare Pages dashboard with build command `npm run build` and output directory
   `web/dist/web/browser`.
3. In CI, the `pages-deploy` job in `.gitlab-ci.yml` does this on `main` (manual trigger),
   and needs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` set as CI/CD variables.
