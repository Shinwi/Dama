# Dama — web app

Moroccan checkers: an Angular SPA (vs computer, local 1v1, and an **online** prototype that
talks to `../server`, see `server/README.md` for running both). See
the repo root `CLAUDE.md` for project context, `docs/RULES.md` for the rules, and
`claude/PLAN.md` for what's next.

## Commands

```bash
npm install

npm start              # dev server at http://localhost:4200
npm run build          # production build -> dist/web/browser

npm run test:engine    # pure rules/AI engine tests (Vitest)
npm test               # Angular component tests (ng test, Vitest runner)
npm run e2e            # Playwright e2e (starts its own dev server on :4300 and the online
                       # server on :3000; run `npm install` in ../server once first)
```

## Project layout

- `src/engine/` — pure TypeScript rules engine and AI. No Angular. `npm run test:engine`.
- `src/app/game/` — framework-free `GameController` + the signals-based `GameService` that
  wraps it and orchestrates the computer's turn.
- `src/app/board/` — the board component (presentational: data in via inputs, taps out via
  an output).
- `src/app/ai/` — the AI web worker and its client, with a main-thread fallback.
- `src/app/audio/` — synthesized sound effects and background music (Web Audio, no files).
- `src/app/online/` — the Socket.IO client for online rooms, and the room-code panel.
- `src/protocol/online.ts` — the messages between this app and the online server.
- `e2e/` — Playwright tests, run against Desktop Chrome and a Pixel 7 profile.

## Deploying to Cloudflare Pages

1. Build: `npm run build`. Output is `dist/web/browser`.
2. `npx wrangler pages deploy dist/web/browser --project-name=dama`, or connect the Git repo
   in the Cloudflare Pages dashboard with build command `npm run build` and output directory
   `web/dist/web/browser`.
3. In CI, the `pages-deploy` job in `.gitlab-ci.yml` does this on `main` (manual trigger),
   and needs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` set as CI/CD variables.

## Deploying to GitHub Pages

Everything is published from the `gh-pages` branch:

- **`master`**: `.github/workflows/deploy.yml` builds and publishes on every push to `master`
  that touches `web/`, to `https://<owner>.github.io/<repo>/`.
- **Pull requests**: `.github/workflows/pr-preview.yml` builds every PR into its own folder,
  `https://<owner>.github.io/<repo>/pr-preview/pr-<number>/`, and posts the link as a comment
  on the PR. Each push to the PR updates the preview, and closing or merging the PR deletes it.

**One-time setup** (a repo setting GitHub Actions can't change): once `deploy.yml` has run at
least once and created the `gh-pages` branch, go to repo → **Settings → Pages → Build and
deployment → Source**, choose **"Deploy from a branch"**, then branch **`gh-pages`**, folder
**`/ (root)`**.

PRs from forks don't get a preview, because their workflow token can't write to the repo.

