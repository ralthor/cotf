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
npm install          # also copies the Stockfish lite and full WASM engines into public/engines
npm run dev          # http://localhost:5173
```

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run preview`.
The 95 MB full engine is always offered and only downloaded when chosen. "Parallel engines" runs several single-threaded engines on different positions at once.

The app remembers your Chess.com and Lichess usernames, imported games and analyses in this browser (localStorage and IndexedDB). Each device keeps its own copy. On any board, **Lichess ↗** opens the current position on the Lichess analysis board. On phones you can swipe across the board to step through moves.

## Openings

The **Openings** tab holds opening repertoires, kept in this browser like everything else.

- Import a public or unlisted **Lichess study** by its link (all chapters), a single **chapter** link,
  a **PGN file** or **pasted PGN**. Every variation, comment, move symbol (`!`, `?!`, `±`…), `[%eval]`,
  arrow and highlighted square is kept. Clocks are dropped.
- Keep several repertoires. Each chapter is trained as White or Black: taken from the study's
  orientation, or chosen at import, and changeable later.
- Importing the same study again, or **Update from Lichess**, replaces its chapters in place.
- Browse a chapter on the board with its comments and arrows, and the full move tree. Keys: ← →
  through moves, ↑ ↓ between variations, Home / End, F to flip.
- Download a chapter or a whole repertoire as PGN, with all annotations.

**Train** (the second sub-tab) quizzes you on a repertoire, or one chapter of it, as White or Black.
The app plays your opponent's moves; you answer by dragging a piece or by tapping it and then its
square.

- **Learn**: new moves are shown with the chapter's comments, then you replay the line from memory.
- **Memorise**: positions due for review (spaced repetition, FSRS); comments appear after you answer.
- **Review**: positions you got wrong, one at a time.
- Hints step by step (piece, square, arrow), or *Show move*. *No hints* turns them off.
- **Mistakes** lists the positions you got wrong and what you played, with a button to practise each.
- **Traps**: opponent moves your studies mark with `?`, `??` or `?!`, and your answer, to practise.
- **Questions about plans** after a right move, from the study itself: a question the author wrote
  as `Q: … A: …`, "where is the plan aimed?" from the move's arrows, or a move left out of the comment.

**Progress** (the third sub-tab) shows, per repertoire and side: positions learnt and mastered, what
is due, first-time accuracy and its change, answers per day for the last 30 days, streaks and
records, progress per chapter, and the hardest positions with a button to practise each.

**Backup** (left column of Openings) exports everything the app keeps in the browser as one JSON
file: repertoires, training, your games, analyses, saved engine and database results, settings and the
language. Your Lichess token is never in it. Importing replaces everything here with the file, except
the Lichess token, which stays. Older openings-only backups still import as before (repertoires merged).
It reminds you when you have training progress and no backup from the last 7 days.

**Games** (the fourth sub-tab) fetches your recent Chess.com and Lichess games and compares them with
the selected repertoire:

- where you left the repertoire, checked with the engine: a playable move is not a mistake; the
  mistakes can be added to Train → Mistakes and Review, or practised right away;
- where your opponents left it: moves your repertoire has no answer to, with a link to prepare one;
- results per chapter (score, wins, draws, losses, moves in book);
- **Start from your games**: a new repertoire from the moves you play most.

- **Your openings**: your games grouped by the opening they reached, with your score.

**Improve** (the fifth sub-tab) learns from your own games, without a repertoire:

- **Weak spots**: positions where your score drops compared with one move earlier, ranked by points
  lost (games × the drop), with how often you reach them, how often you lose and the move number as
  sortable columns.
- **Better moves**: your moves compared with the Lichess players database (your rating group and the
  next, at the speeds you play; needs your Lichess token) or the masters database, ranked by points to
  gain. Only main moves are suggested.
- Every row opens what is behind it: the numbers worked out step by step, every move order that reaches
  the position, what was played next, the database's moves, and the games themselves with links and
  **Analyse**.
- **Lost in the opening**: each recent game with the move where your win chances dropped most, from
  Stockfish running in your browser (pick the depth) or from the opening database's results (how
  players actually scored), with the best move and where you stood when the opening ended.
- A **game player** shows any of these games with the move played, the engine's move and the database's
  move side by side, your win chances, and links to the game on Lichess and to Analyse at that move.
- **My fixes**: a better move becomes a training chapter that starts at that position, with the
  opponent's likely replies from the database.
- **Not a problem** hides a finding.
- In Browse, **Your games here** shows the same for the selected position.

Positions are named with ECO codes and opening names from the Lichess
[chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0), bundled and available
offline. In Browse, the optional **Explorer statistics** panel shows how often each move is played and
how it scores: the Masters database works as is; the Lichess players database needs your own Lichess
API token (no permissions), kept in this browser.

Only the players, ratings, result, date, first 40 moves and the game's PGN (to open it in Analyse)
are kept, in this browser. Only
standard chess is supported; see `docs/OPENING_TRAINER.md` for what comes next.

## Install and offline use

Chess on the Fly can be installed as an app (**Install** in the header in Chrome and Edge; Share → Add
to Home Screen in Safari) and works offline after the first visit: the app, your repertoires and
training, PGN import, opening names and the lite engine. Fetching games, importing Lichess studies and
the opening explorer need a connection. A new version waits for you to click **Reload**.

## Languages

English and Persian (right-to-left). Pick one in the header menu; the choice is kept in
this browser, otherwise the browser's language is used. Texts are keys; each language is
one flat JSON file in `web/src/i18n/locales/` (`"key": "text"`). A missing key falls back
to English. To add a language, copy `en.json` to `<code>.json` and translate the values,
keeping the `{placeholders}`. `src/i18n/i18n.test.ts` checks that every file has the same
keys. Exported PGN/JSON and the brilliancy gate details stay in English.

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

To open a finished Lichess game directly, link to `#/analyse?lichess=<gameId or URL>`, for
example `https://ralthor.github.io/cotf/#/analyse?lichess=abcdefgh`. The older form
`https://ralthor.github.io/cotf/?lichess=https://lichess.org/abcdefgh` works too. The game is
imported (or selected, if it's already in this browser) and the parameter is removed from the
address. Values that aren't a Lichess game (a study, another site) show an error instead.

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
