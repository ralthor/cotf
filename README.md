# Chess Game Analyser

An independent, browser-first review tool for **finished** chess games. Stockfish runs as WebAssembly in your browser. Moves get our own explainable labels (Best, Good, Inaccuracy, Mistake, Blunder) and an experimental **brilliant-move (`!!`) detector** based on shallow-to-deep rank reversal.

Not affiliated with Chess.com or Lichess. No live-game assistance.

| Folder | Contents | Phase |
| --- | --- | --- |
| `web/` | React + TypeScript + Vite app, Stockfish WASM worker, importers, analysis, research harness | 1, 1.5 (+ optional backend UI) |
| `backend/` | Django REST API, accounts, game library, sync, stats (`accounts`, `games`, `analysis`) | 2 |
| `backend/cloud/`, `backend/Dockerfile.engine` | Native Stockfish cloud workers, job queue, quotas | 3 |
| `shared/` | Fixtures both implementations must agree on | — |
| `docs/` | Handoff, decisions, API notes, algorithms | — |

## Browser app (no backend needed)

Requires Node 20+.

```bash
cd web
npm install          # also copies the Stockfish lite WASM engine into public/engines
npm run dev          # http://localhost:5173
```

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run preview`.
To also offer the 95 MB full engine: `COPY_FULL_ENGINE=1 npm install`, then build or run with `VITE_FULL_ENGINE=1`.

The app remembers your Chess.com and Lichess usernames, imported games and analyses in this browser (localStorage and IndexedDB). Each device keeps its own copy. On any board, **Lichess ↗** opens the current position on the Lichess analysis board. On phones you can swipe across the board to step through moves.

## Publish on GitHub Pages

`.github/workflows/deploy-pages.yml` builds `web/` and deploys it on every push to `main` that touches `web/`.

1. Push this repository to GitHub. It must be **public** on the free plan.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`, or run the workflow from the **Actions** tab.

The site appears at `https://<user>.github.io/<repo>/`. The workflow sets `BASE_PATH` to `/<repo>/` automatically, or to `/` if the repository itself is `<user>.github.io`. To build a copy by hand for any sub-folder: `BASE_PATH=/some-folder/ npm run build`, then publish `web/dist/`. Only the browser app is published; Library, Stats and cloud analysis need the backend.

You can import games in three ways:

- Paste or upload a PGN.
- Fetch a Chess.com username's monthly archives (these can lag up to about 12 hours).
- Fetch a Lichess username's games, or paste a Lichess game URL (available immediately after the game ends).

## Backend (optional)

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv sync
DJANGO_DEBUG=1 uv run python manage.py migrate
DJANGO_DEBUG=1 uv run python manage.py runserver
DJANGO_DEBUG=1 uv run pytest
```

Run the web app with `VITE_API_URL=http://localhost:8000 npm run dev` to enable Library, Stats, Save to library and Deep cloud analysis. Background sync and cloud jobs need Redis and Celery workers (`celery -A config worker -Q sync`, `-Q engine`) and a `stockfish` binary on `PATH` (or `STOCKFISH_PATH`).

## Full stack with Docker

```bash
cp backend/.env.example backend/.env    # set DJANGO_SECRET_KEY and PROVIDER_USER_AGENT
docker compose up --build               # web :8080, api :8000
```

## Licences

Stockfish.js is GPL-3.0. Its licence text is served at `/engines/STOCKFISH-COPYING.txt`, and the footer links to the corresponding source. This project is therefore distributed under GPL-3.0-or-later. react-chessboard and chess.js are BSD/MIT-style licences. Review all licences before public deployment.

See `docs/DECISIONS.md` for verified findings and open questions.
