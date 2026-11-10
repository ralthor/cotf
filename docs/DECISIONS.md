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
- **Engine:** `stockfish@19.0.1` (nmrugg, GPL-3.0). **Lite single-threaded** (1.7 MB, default) and **full single-threaded** (~95 MB, only downloaded when chosen) are both copied to `public/engines/` by a postinstall script and always offered.
- **Speed comes from parallel engines, not threads.** Stockfish's threads make a search stronger in the same time but do not reach a fixed depth sooner, and our labels use fixed depths. Measured in Node on a 6-core/12-thread i7-7800X (lite multi-threaded build, 4 positions):
  - to depth 16: 1 thread 1.75 s, 6 threads 5.76 s with the default 16 MB hash, 2.02 s with 256 MB;
  - to depth 20 (256 MB): 1 thread 6.3 s, 6 threads 12.0 s;
  - 1 s per position: 6 threads searched 5.7x more nodes but reached about the same depth.
  The Stockfish docs agree: thread gains are measured as strength at equal time. Several **single-threaded** engines on different positions did 12 positions to depth 16 in 4.27 s (1 engine), 1.77 s (4), 1.43 s (6), 1.45 s (11). So the app runs an `EnginePool` of single-threaded engines ("Parallel engines" setting: default cores − 1, at most 6; full build at most 2 for memory). The first pass, the deep pass, the brilliancy candidates and the four searches inside each brilliancy check run in parallel. Every search stays single-threaded and reproducible, no cross-origin isolation is needed, and cache keys are unchanged. Multi-threaded builds are not shipped.
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

## Brilliancy (`brill-v3`, experimental)

v1 used a shallow window of depths 1–8 and treated a low shallow rank as "overlooked". In practice this
flagged moves in already-winning positions: a move ranked 26th of 34 at +4 while the best was +8 still wins,
and other moves won just as well. v1 also displayed ranks as `#26`, which reads as "mate in 26". v2 follows
the original idea more closely: **limit the look-ahead to 1–3 plies and require the move to look bad there.**

- **Shallow look (horizon, default 3 plies, 1–6 in the harness):** one full-width search
  (MultiPV = every legal move) to the horizon with a cleared hash, so each move's score and rank at depths
  1..horizon are exact.
- **Checks (all must pass):**
  1. *looks-bad-at-shallow-depth:* at the horizon, the played move is ≥ 10 points (mistake level) worse than
     the best move at that depth.
  2. *best-at-depth:* best or tied at full depth, and the mover's expected score ≥ 40%.
  3. *decisive:* best minus second-best at depth ≥ **8** points. This is tentative: the v1 false positive had
     1.1, and Légal's 5.Nxe5 has about 9.4.
  4. *found-beyond-horizon:* the same move (`searchmoves` trajectory) becomes sound only at a depth greater
     than the horizon, and stays sound for ≥ 3 trailing depths.
  5. *stable-on-recheck:* an independent search 2 plies deeper agrees.
- **Verdict:** checks 1–4 plus a stable recheck give *brilliant*. Checks 1–4 with no recheck give *candidate*.
  Anything else gives *none*. The 0–100 score only ranks the strength of the evidence (shallow loss 30,
  inversion 25, decisiveness 20, sacrifice 15, discovery depth 10). It no longer gates the verdict.
- **Real-engine results (Stockfish 19 lite, deep 18, recheck 20):**
  - Opera Game 16.Qb8+ with a 1-ply horizon: **brilliant**. It is 43rd of 46 moves at depth 1 and found at depth 3.
  - Légal's 5.Nxe5 with a 3-ply horizon: passes every check. It is 28th of 35 and found at depth 7.
  - The old harness example (White already +8): **not brilliant**, because it is not decisive (0.7 points).
- In whole-game review, candidates are best-labelled moves with at least two of: preferred differently by the
  first pass within the horizon, decisive at the first pass, or a sacrifice.
- **v3, sliding horizon (sacrifice size):** how far a move is from a normal thought process depends on what
  it gives up. Players calculate knight sacrifices; almost nobody looks even one move past losing the queen.
  - Sacrifice size D (pawns) is the larger of the deficit along the engine line and what the opponent can win
    by capturing right after the move (static exchange, `offered`).
  - **D ≥ 8 (queen): horizon 1 ply.** A queen sacrifice followed by mate in one can be brilliant. For these,
    *looks-bad* also passes when the opponent can simply win ≥ 5 by taking (e.g. queen for a rook), since a
    1-ply Stockfish search may already see a very short mate.
  - **D < 8 and quiet moves: unchanged** (the full shallow horizon, 3 plies).
  - Sacrifice detection: the deficit may last a single reply when the line ends in mate (otherwise 2, so a
    queen trade is not a sacrifice). A quiet move that leaves a piece hanging (`offered ≥ 2`) now counts, so
    such moves are considered as candidates more often; the checks themselves are the same.
  - Score: the sacrifice component is 5 + 10 · min(D, 9) / 9 instead of a flat 15.
  - The *decisive* check still applies, deliberately kept strict: a queen sacrifice in a position where another
    move also wins for sure is not brilliant. Example (real engine, d20): Philidor's 1.Qg8+!! Rxg8 2.Nf7# passes
    every other check with the 1-ply horizon but is *not brilliant*, because 1.Nf7+ also mates (in 4), so the
    gap to the second-best move is 0. A "fastest mate counts as decisive" rule was considered and rejected.
- **Known limit:** Stockfish "depth 3" still includes quiescence search and a strong NNUE evaluation, so it sees
  more than a human looking 3 plies ahead. A material-only shallow search would model a human more literally.

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
- **GitHub Pages:** `BASE_PATH` sets Vite's `base`. `.github/workflows/deploy-pages.yml` derives it from the repository name (`/` for a `<user>.github.io` repo) and deploys `web/dist`. A `/chess-analyser/` build was verified in the browser: the engine loaded from the sub-folder and an analysis ran. Both the lite and the full engine are published; the full one is only downloaded when a user picks it.
- **Privacy:** the original Chess.com test handle was replaced with `example_player` in the docs and test fixtures.

## Review UI (third round)

- **No forced scrolling while reviewing.** The move list now scrolls only its own box. It used
  `scrollIntoView`, which also scrolled the page and pulled the board away. Verified: 25 steps on a phone and 12
  on desktop kept the page scroll at 0.
- **Category badge on the landing square** of the last move (for example "?" on f6 for 6...Nf6), drawn as an
  overlay above the board.
- **Move feedback card directly under the board**, so nothing requires leaving the board:
  - It shows the move, its label, the loss in points and the evaluation.
  - When the move was not best, **Show better move** reveals the better move, the best line (6 plies) and the
    line after the played move. Each line has **▶ Play on board**.
  - **Hint: best move** reveals the best move from the current position, with an arrow.
  - Both stay hidden until asked, and reset on every new position. **Always show best moves** is remembered.
  - The old always-on best-move arrow and the side "Engine lines" panel were removed.
- `MoveAnalysis.playedPv` stores the played move's continuation for the "after your move" line.
- **Phone imports:** after you tap a game in a fetched list, or in your games list, the page scrolls up to the
  board if it is off-screen. Before this, the game opened above the list, out of view, and seemed not to
  import. Fetched lists mark games already in your list with "✓ in your games".
- **Fixed:** the ✕ (remove) button in the games list took the full row width, squeezing titles.
