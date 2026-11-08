# Decisions and findings

Running log of implementation decisions, deviations from `CHESS_ANALYSER_HANDOFF.md`, and verified findings. Newest first within each section.

## Verified findings (8 Nov 2026)

- **CORS works for both providers from the browser.** Checked with `curl -H 'Origin: …'` and then in a real browser (built-in preview pane) against the production build:
  - `api.chess.com/pub/...` returns `Access-Control-Allow-Origin: *`. Archive index and month JSON for a real public account loaded, newest first.
  - `lichess.org/api/games/user/...` and `lichess.org/game/export/{id}` echo the requesting origin in `Access-Control-Allow-Origin`. Game-URL import worked.
  - **No server proxy is needed for Phase 1.**
- **Lichess's preflight allow-list does not include `If-None-Match`.** Sending it from the browser would trigger a failing preflight. The browser client therefore does not set conditional headers itself (`manualConditional` is off by default) and relies on the browser HTTP cache, which revalidates with ETag/Last-Modified transparently. The server-side clients (Phase 2) do send `If-None-Match` / `If-Modified-Since`.
- **Chess.com behind Cloudflare.** A `curl` without a User-Agent got a Cloudflare challenge page; with a User-Agent it returned 200. Browsers always send a UA. Server-side sync sets `PROVIDER_USER_AGENT` (configure a real contact address).
- **`chess.js` 1.4 `getHeaders()` drops `SetUp`/`FEN`.** We parse tag pairs ourselves (`parseHeaders`) and keep every header.
- **`chess.js` keeps the main line and skips RAVs (variations)**, which is the defined MVP behaviour. Comments are keyed by FEN, which is ambiguous only when a position repeats; clocks and comments are display-only.
- **Real-engine smoke test (Stockfish 19 lite WASM, Standard preset)** on Morphy's Opera Game: 9...b5 and 6...Nf6 were labelled *Mistake*. The detector flagged 13.Rxd7 as *Brilliant* (shallow rank #6 → #1, discovered between depth 7 and 8, stable on recheck) and 10.Nxb5 as a *Brilliant candidate*. 16.Qb8+ was **not** flagged: it is a mate-in-2 the engine sees at depth 1, so nothing was overlooked. This is the intended behaviour of the heuristic, not a bug.

## Stack and layout

- **Monorepo:** `web/` (Phase 1 + 1.5 frontend), `backend/` (Phase 2 Django + Phase 3 cloud app), `shared/` (cross-language test fixtures), `docs/`. The handoff suggested a single `chess-analyser/` root. We split frontend and backend so each has its own toolchain. The handoff stays in `docs/` rather than being copied to the root.
- **Frontend:** React 19, Vite 8, TypeScript 6.0 (not 7: `typescript-eslint` supports `<6.1`), chess.js 1.4, react-chessboard 5, idb 8, Vitest 5, Playwright 1.65 (configured, no e2e specs yet).
- **Engine:** `stockfish@19.0.1` (nmrugg, GPL-3.0). The default is **lite single-threaded** (1.7 MB, no COOP/COEP needed), copied to `public/engines/` by a postinstall script. The ~95 MB **full single-threaded** build is opt-in (`COPY_FULL_ENGINE=1 npm install`) and selectable in the UI. Multi-threaded builds are not shipped, since they need cross-origin isolation.
- **Backend:** Django 6.1, DRF 3.18 (token auth), django-filter, Celery 5.7 + Redis, PostgreSQL through `DATABASE_URL` (SQLite for dev/tests), `chess` 1.11 (python-chess), httpx. Managed with `uv`.
- **Node** was not installed on the dev machine. Node 24 LTS was installed to `~/.local/node` from the official tarball (SHA-256 verified). Put `~/.local/node/bin` on `PATH`.
- **Dev-only audit warning:** `npm audit` reports a moderate `minimatch` advisory pulled in through ESLint 10. It is dev-only, and the suggested fix downgrades ESLint. Left as is.

## Engine protocol

- **Played-move scoring: method B (restricted root).** The played move is scored from `fenBefore` with `go depth D searchmoves <uci>`, at the same depth as the root MultiPV-2 search. It is compared against the root's best line, both from the mover's perspective. If the played move is already one of the two root lines, that line's score is used directly. Method A (evaluating `fenAfter`) is not used, because it adds a ply of search-depth mismatch.
- **Scores are stored white-relative**, as a discriminated union (`cp` | `mate{moves, winner}`). Converting from the UCI side-to-move convention happens once, in `toWhiteScore`.
- **Same-depth MultiPV only.** The final lines come from the deepest depth whose MultiPV set is complete. Lines from different depths are never mixed. Every per-depth snapshot is kept (`byDepth`) for the brilliancy trajectory.
- **Stop handling:** after `stop`, the client waits up to 2 s for `bestmove`, then restarts the worker. Searches are serialised through one worker, and each has a generation number.
- **Terminal positions** (checkmate, stalemate, insufficient material) are answered without the engine.
- **Per-search time cap** (`movetimeCapMs` per preset) is added to the review passes so one complex position cannot stall a review. Research and brilliancy searches are depth-only, to stay reproducible, and clear the hash (`ucinewgame`).

## Scoring and labels

- **Expected score** = logistic of cp with k = 0.00368208, or W/D/L when the engine provides it. Mates map to 0 or 1.
- **Classifier `cls-v1`** (all thresholds are losses of the mover's expected score, in percentage points): best ≤ 1.0 (and ≤ 10 cp), good ≤ 4, inaccuracy ("questionable") ≤ 10, mistake ≤ 20, blunder above that. Priority order: brilliant → forced → best/tie → allowed mate → missed mate → slower mate (good) → thresholds. The user-facing label is **"Inaccuracy"**, with "questionable" as the internal key. **Mistake is a separate tier.**
- **Accuracy `acc-v1`:** per move 100·e^(−0.045·loss), averaged over non-forced moves. No value is shown below 5 scored moves, and it is marked provisional until the analysis completes. Provider accuracy is shown in a separate row and is never substituted.
- **Parity:** `shared/classifier-cases.json` is checked by both the TypeScript and Python test suites.

## Brilliancy (`brill-v1`, experimental)

- Signals are measured as follows:
  - **Shallow rank:** one MultiPV = min(legal, 64) search to depth 8 with a cleared hash, so ranks are exact at every depth 1..8.
  - **Same-move trajectory:** `searchmoves <played>` to the deep depth.
  - **Deep verification:** root MultiPV 2.
  - **Recheck:** an independent root search 2 plies deeper.
- **Hard gates:**
  - **Deep quality:** best or tied at depth, and the mover's expected score ≥ 40%.
  - **Overlooked:** shallow rank ≥ 3, or a same-move inversion of ≥ 15 points.
  - **Sustained discovery:** unsound up to some depth ≥ 3, then sound for ≥ 3 consecutive trailing depths, with discovery depth ≥ 4.
- **Weighted score:** inversion 30, rank 25, uniqueness 20, sacrifice 15, discovery depth 10. ≥ 40 makes a *candidate*. ≥ 55 **and** a stable recheck makes *brilliant*. An unstable recheck makes it *none*.
- **Sacrifice** means a material deficit of ≥ 2 pawns that persists for ≥ 2 consecutive mover-to-move checkpoints along the PV, so exchanges and recaptures cancel out.
- In whole-game review, only a few candidates per game are checked: best-labelled moves with ≥ 3 legal moves, and at least two of these signals: shallow miss, sacrifice, or a gap ≥ 15 to second best.
- **Not yet done:** tuning the weights on a curated validation set (handoff §12). The current numbers are first guesses, checked only against synthetic fixtures and the Opera Game.

## Imports

- **Chess.com game URLs:** detected, and the user gets an honest "not supported yet, paste the PGN" message. No undocumented endpoint is used.
- **Lichess username vs. bare game ID are ambiguous** (for example, "thibault" is 8 alphanumeric characters). In the UI, only input containing `lichess.org` is treated as a game. The API layer (`parseLichessGameId`) still accepts bare IDs.
- **Lichess:** NDJSON is streamed with `pgnInJson`, `clocks`, `opening` and `finished=true`. In-progress, aborted and non-standard games are refused. On `429` the client waits 60 s.
- **Chess.com:** archive months are fetched serially, newest first. Past months are marked complete in the server sync cursor and never refetched. The current month is revalidated with its ETag.

## Phase 2 / 3 backend

- Analysis runs are **immutable**: every browser upload or cloud job creates a new `AnalysisRun`. Uploaded browser results are **re-classified server-side** with the Python port, so client labels are never trusted. Moves are validated against the stored game.
- Game dedupe uses (user, provider, external_id) when known, otherwise (user, content hash). The hash covers start FEN, UCI movetext, date and player names.
- Each user may link **one external account per provider**.
- **Cloud jobs:**
  - Profiles: `cloud-standard` (d20 → d24) and `cloud-deep` (d22 → d28 on key positions). Depth 28 is used only for deep checks and brilliancy candidates, not every position.
  - Limits: per-user active-job cap, daily position quota, cancel flag polled between searches, soft/hard Celery time limits, and a stale-job reaper.
  - Isolation: engine subprocess under `RLIMIT_AS`/`RLIMIT_CPU`. The worker container runs `read_only`, `cap_drop: ALL`, `no-new-privileges` with CPU/memory/pid limits.
- **Not run here:** Docker images and `docker compose` (the Docker daemon is not accessible to this user). PostgreSQL and Redis are unverified in practice. Tests use SQLite and eager Celery.
- **Stats phases** are approximated by ply (opening ≤ 20, middlegame ≤ 60). Material-based phase detection is a follow-up.

## Known gaps / follow-ups

- No Playwright e2e specs yet (config only). The browser checks above were manual.
- react-chessboard renders squares as unnamed buttons, which is poor for screen readers. Consider an accessible move list as the primary navigation (already keyboard-driven: ← → Home End, `f` to flip).
- Opening-book handling: early "best" moves count towards accuracy. Consider excluding book moves.
- Brilliancy weight calibration on a labelled dataset.

## Additions (8 Nov 2026, second round)

- **Open on Lichess:** each board has a **Lichess ↗** link to `https://lichess.org/analysis/standard/<FEN with _>?color=<orientation>`. It follows the shown position, including engine-line previews, and was verified to open the exact position. Only the FEN and orientation are sent.
- **Remembered usernames:** the Chess.com username (and months setting), the Lichess username and the last import tab are kept in `localStorage` under `chess-analyser:*`. They are saved after a successful fetch, with a **Forget** button. They are per device and per browser; there is no cross-device sync without the backend.
- **Phone layout (≤ 700 px):**
  - The selected game is shown first, with a horizontal eval strip above a full-width board.
  - A sticky bottom bar has large ⏮ ◀ ▶ ⏭ ⇅ and Lichess buttons. Swiping on the board steps moves, or steps through the engine line while previewing one.
  - The current-move panel comes right under the board, and tap targets are 40–44 px.
  - The desktop layout is unchanged.
- **GitHub Pages:** `BASE_PATH` sets Vite's `base`. `.github/workflows/deploy-pages.yml` derives it from the repository name (`/` for a `<user>.github.io` repo) and deploys `web/dist`. A `/chess-analyser/` build was verified in the browser: the engine loaded from the sub-folder and an analysis ran. Only the lite engine is published. The full-engine option is shown only when built with `VITE_FULL_ENGINE=1`.
- **Privacy:** the original Chess.com test handle was replaced with `example_player` in the docs and test fixtures.
