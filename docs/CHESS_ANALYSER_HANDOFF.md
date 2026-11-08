# Browser-Based Chess Game Analyser — Project Handoff

**Status:** Phases 1, 1.5, 2 and 3 implemented (8 Nov 2026). See `docs/DECISIONS.md` for deviations and verified findings.  
**Prepared:** 8 November 2026  
**Audience:** Coding agent working in a local project folder.  
**Primary goal:** Deliver a working browser-first chess game analyser, then progressively add persistence, accounts, historical statistics and optional cloud analysis.

> **Instructions for the coding agent:** Read this document before changing code. Inspect the existing project directory first and preserve useful existing work. Treat the decisions below as requirements unless marked “proposal,” “experimental,” or “unverified.” Implement in small, testable increments. Do not assume features have already been built. If no code exists, scaffold the MVP. Update this file or a linked `DECISIONS.md` as implementation decisions change.

## 1. Product vision

Build an independent, web-based chess game analyser powered by Stockfish, with a pleasant game-review experience. Users can import finished public Chess.com games, finished public Lichess games or PGN files, step through every position, see best alternatives and evaluation changes, and receive an **original, explainable move classification**. The distinguishing feature is a proposed **brilliant-move (`!!`) detector based on shallow-to-deep evaluation/rank reversal**, rather than simply calling every engine-best move brilliant.

Eventually, allow players to connect *by public username* on Chess.com and/or Lichess (without provider authentication for public games), store their game histories and engine-analysis results, examine game accuracy trends, and request stronger/deeper analysis on cloud workers.

This is **not** a live-play assistance tool. Analyse completed games only; do not integrate engine recommendations into ongoing rated games.

## 2. Scope and phases

### Phase 1 — Browser-first MVP (must deliver first)

- Static/deployable website; no mandatory application backend or user login.
- Import one or more games from a `.pgn` file or pasted PGN text.
- Import public finished games by Chess.com username via official PubAPI (including current month), with game selection and sorting latest first.
- Import public finished games by **Lichess** username via the official Lichess API (latest first), and import a single Lichess game by its game URL or ID (see §3b).
- Parse legal moves, PGN headers and any standard initial FEN; reconstruct every position.
- Interactive chessboard with move list, first/previous/next/last controls and board orientation.
- Load Stockfish WebAssembly in a **Web Worker**; do not block the UI thread.
- Analyse positions and compare the best move with the move played; expose progress, cancellation and failure states.
- Show engine score, candidate lines (MultiPV), played move and suggested move, centipawn/evaluation loss and per-move labels.
- Labels: **Best, Good, Questionable/Inaccuracy, Mistake (optional separate tier), Blunder, Brilliant**. Define these using our own thresholds and algorithm; clearly state that results are estimates, not official Chess.com classifications.
- Game summary for both colours with **our own** accuracy metric and move-category counts; distinguish it from any accuracy field supplied by Chess.com.
- Basic accessibility, responsive layout and complete-game/partial-game progress reporting.

### Phase 1.5 — Quality and usability

- Evaluation chart, playable principal variations, chessboard arrows for recommended moves.
- IndexedDB/local caching of imported games and keyed engine results so reloads don't discard work.
- Export analysed PGN / JSON with annotations; filters for blunders and brilliant candidates.
- A dedicated view explaining why a move was classified as brilliant with depth-by-depth evidence.
- Optional batch import of multiple archive months, constrained concurrency and progress.

### Phase 2 — Persistent backend

- User accounts (local accounts, not necessarily Chess.com or Lichess OAuth); user supplies public Chess.com and/or Lichess usernames.
- Scheduled, idempotent synchronisation of public Chess.com archives and Lichess game exports (using `since` cursors); historical game library across both providers.
- PostgreSQL for users, games, moves, immutable engine analyses, aggregated summaries and job states.
- Filters by colour, game type (rapid/blitz/bullet/daily), opponent, date, result and rating.
- Game-by-game accuracy, historical accuracy trends, mistake types, opening/game-phase stats.
- API endpoints for listing games, retrieving analysis and submitting/monitoring analysis jobs.
- Background workers with retries, deduplication, throttling and resource budgets.

### Phase 3 — Optional cloud computation

- Run **native Stockfish on CPU-based cloud workers** for selected positions/full games at stronger search settings, for example depth 28 when justified.
- Browser sends a job; backend queues, runs, saves, and returns or streams progress/results.
- Prioritise interesting/ambiguous positions and potential brilliant moves rather than expensive deep analysis of every position by default.
- Allow different engine profiles (fast local, standard local, deep cloud) and compare their results with version/settings clearly recorded.
- Add authentication, job quotas, cost controls, cancellation, per-user concurrency limits and worker isolation before exposing expensive cloud jobs publicly.

**Explicitly out of MVP scope:** live games, playing against an engine, Chess.com or Lichess account login, social features, exact reproduction of Chess.com's accuracy or proprietary move labels, guaranteed instant game-URL extraction, GPU-based Stockfish acceleration.

## 3. Chess.com game import — official, verified path

Chess.com's **Published-Data API (PubAPI)** exposes public, read-only data **without OAuth/API keys**. Monthly archives include finished games **during the current month**; a month does **not** have to be complete.

For username `example_player`, as of this handoff's date (November 2026):

```text
# Index of months available to the player
https://api.chess.com/pub/player/example_player/games/archives

# Current-month game objects in JSON
https://api.chess.com/pub/player/example_player/games/2026/11

# Current-month multi-game PGN download
https://api.chess.com/pub/player/example_player/games/2026/11/pgn
```

**Note:** A previous conversation erroneously used `/2026/08` as “current month”; **November (`/2026/11`) is correct on 8 Nov 2026**. In code, derive the **relevant UTC/calendar month from the user's context or game timestamps**, not a hard-coded date, and inspect the archive index for which months actually exist. Dates near month boundaries need attention.

Expected archive shape (illustrative fields, not a promise that every field is present):

```ts
type ChessComGame = {
  url?: string;                  // source game URL; useful for deep linking/deduplication
  pgn?: string;                  // prefer this for parsing
  tcn?: string;                  // Chess.com compact move encoding; optional/opaque
  end_time?: number;             // Unix seconds, typically suitable for sorting finished games
  time_class?: string;           // rapid/blitz/bullet/daily etc.
  time_control?: string;
  rules?: string;                // filter unsupported variants for MVP
  white?: { username?: string; rating?: number; result?: string };
  black?: { username?: string; rating?: number; result?: string };
  accuracies?: { white?: number; black?: number }; // may be absent; supplied by provider
  fen?: string;
};
type ChessComMonthlyResponse = { games: ChessComGame[] };
```

- Sort by `end_time` descending to find the latest **currently published** completed game, not necessarily the last one actually played.
- `pgn` is the primary import format; **`tcn` can appear in the JSON response** but does not need to be decoded for MVP. Treat it as an optional provider-specific optimization; preserve it if useful, but never assume it is always present.
- The `/pgn` endpoint downloads **the whole month**, not only one game. For a specific/latest game, fetch JSON, select one object and use its `pgn` field; offer local `.pgn` download.
- Chess.com API responses can be cached and endpoints **refresh at most once every 12 hours**. This is a refresh-frequency statement, **not an SLA guaranteeing visibility within 12 hours**. Finished games can therefore be missing immediately after a game ends.
- Use `ETag`, `Last-Modified`, response caching semantics, bounded request frequency and retry/backoff on `429`. Serial requests are recommended over aggressive parallel archive fetching.
- For **server-side** requests identify the app with a meaningful User-Agent/contact. **JavaScript `fetch()` cannot freely set the `User-Agent` header in browsers**; don't attempt to force it there.
- **Verify cross-origin `fetch()` (CORS) directly in target browsers before designing around client-only PubAPI ingestion.** Opening an API URL in a browser is not proof that JavaScript from our domain can fetch it. If blocked, use a minimal compliant server proxy in a later stage, or retain the PGN import workaround.
- Filter standard chess (`rules`); support for Chess960 and variants is a future explicit decision.
- Validate external data; support missing fields, removed games, malformed PGN, pagination-by-month, empty months, and partial archives.

### Immediate post-game import and Chess.com game URLs

The desired UX is: **finish a game → open our site → analyse immediately**. Official monthly archives cannot guarantee this. A public Chess.com game URL may be viewable immediately, but **we have NOT verified a documented official URL-to-PGN endpoint or a browser-safe extraction method**. Do not claim game-URL imports work out of the box.

Plan for three distinct import paths:

1. **Reliable immediate path:** paste PGN or upload exported PGN from Chess.com.
2. **Convenient automatic path:** public username → current/monthly PubAPI archive, with an explicit “latest published game” indicator and stale-data warning.
3. **Research task:** investigate whether a public completed-game URL can lawfully and reliably yield PGN immediately, including CORS, authentication, provider terms and failure modes. Any undocumented endpoint/scraping must remain an optional adapter, not a critical dependency.

For UX, allow pasting a Chess.com URL but return an honest “unsupported/not yet available” state or link to export PGN until that adapter is proven; never silently pretend the import succeeded.

## 3b. Lichess game import — official API

Lichess (lichess.org) offers a free, open, documented API. Public games can be exported **without authentication**. Unlike Chess.com's monthly archives, a finished Lichess game can be exported by ID **as soon as it ends**, so Lichess gives a reliable path for “finish a game → analyse immediately”.

```text
# A user's games, newest first (streamed; NDJSON or multi-game PGN)
https://lichess.org/api/games/user/{username}?max=20&pgnInJson=true&clocks=true&opening=true
#   Accept: application/x-ndjson   -> one JSON game object per line
#   Accept: application/x-chess-pgn -> multi-game PGN
#   optional filters: since/until (Unix ms), rated, perfType (bullet,blitz,rapid,classical,correspondence), finished

# A single game by ID (PGN by default; JSON with Accept: application/json)
https://lichess.org/game/export/{gameId}?clocks=true&opening=true
```

- **Game URLs:** accept `https://lichess.org/{id}`, `…/{id}/white`, `…/{id}/black`, and 12-character player-specific IDs (`https://lichess.org/{id8}{suffix4}`). The game ID is the **first 8 characters** of the path segment. Validate that it matches `[A-Za-z0-9]{8}` and that the host is exactly `lichess.org` before fetching. Don't accept arbitrary hosts.
- **Format:** prefer `pgnInJson=true` with NDJSON so each game carries both metadata and a `pgn` field. Parse NDJSON line by line as a stream and stop after `max` games. Don't wait for a huge response.
- **Fields (illustrative, may be absent):** `id`, `rated`, `variant`, `speed`, `perf`, `createdAt`, `lastMoveAt`, `status`, `players.white/black.user.name`, `players.*.rating`, `winner`, `opening`, `clock`, `pgn`. Sort by `lastMoveAt` (or `createdAt`) descending.
- **Variants:** MVP supports `variant === 'standard'` only, plus `fromPosition` if the PGN carries a valid `FEN` header. Skip others with a clear message (the same as Chess.com `rules`).
- **Unfinished games:** filter to finished statuses (`mate`, `resign`, `outoftime`, `timeout`, `draw`, `stalemate`, etc.). Never analyse an ongoing game (`started`/`created`), in line with the no-live-assistance rule.
- **Rate limits:** Lichess asks clients to make **one request at a time**. On `429`, wait **at least one full minute** before retrying. Serialise all Lichess requests through one queue.
- **CORS:** the Lichess API is expected to allow cross-origin browser requests, but **verify in target browsers** with the same spike as Chess.com before relying on it.
- **Engine evals in exports:** Lichess may include its own `[%eval]` comments if `evals=true`. MVP doesn't request them. If ever shown, label them as provider data, separate from our own analysis (the same rule as Chess.com `accuracies`).
- **Compliance:** show a non-affiliation disclaimer for Lichess as well. Don't copy Lichess branding or piece sets beyond what their licences allow.

The import UI should offer one adapter interface with three sources: `chesscom` (username → month archive), `lichess` (username → recent games; game URL/ID → single game) and PGN file/paste. Each adapter returns raw PGN plus provenance, and all of them feed the same PGN parser.

## 4. PGN, board and position model

Recommended frontend stack (proposal, change if the folder already has a good scaffold): **TypeScript, React, Vite, chess.js, react-chessboard**. Use a normal component/state approach; the Stockfish protocol adapter and chess logic should be framework-independent modules. Add Vitest for unit tests and Playwright for end-to-end smoke tests. No mandatory backend in phase 1.

PGN import must:

- Support PGN metadata (`Event`, `Site`, `Date`, `White`, `Black`, `Result`, ratings, `TimeControl`, and `SetUp`/`FEN` when present).
- Parse multiple games in one file; handle whitespace, comments, annotations, optional clock data, and variations in a defined way. For MVP main line only is acceptable, but never corrupt positions.
- Validate moves and report invalid input without crashing. Guard file size and number of games.
- Generate **position 0 before any moves**, and one subsequent FEN for each ply (`ply 1..N`).
- Store each move with `ply`, `fullMoveNumber`, `colour`, `SAN`, `UCI`, `fenBefore`, `fenAfter`, check/mate/status, and optionally clock/comment.
- Keep canonical moves/positions separate from presentational board state and engine results.
- Correctly handle castling, en passant, promotion, disambiguation, FEN's side-to-move, chess clocks and resignations.

Suggested model:

```ts
type GameRecord = {
  id: string;                        // stable local ID, e.g. source URL or PGN-content hash
  source: 'chesscom' | 'lichess' | 'pgn-file' | 'pgn-paste';
  sourceUrl?: string;
  headers: Record<string, string>;
  rawPgn: string;
  importedAt: string;
  moves: MoveRecord[];
};

type MoveRecord = {
  ply: number;
  san: string;
  uci: string;
  colour: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
};
```

## 5. Stockfish WebAssembly in a Worker

Use the actively maintained **`stockfish` npm package / nmrugg Stockfish.js** or another verified WASM build. Do **not** accidentally choose the older `stockfish.js` npm package merely because of the similar name. Verify current versions, licence and browser compatibility when installing.

As of 8 Nov 2026, the `stockfish` package offers full and lite builds, with single-threaded options. **Suggested MVP default: lite single-threaded WASM**, which is small, easy to serve on ordinary static hosting, and does not need cross-origin isolation. Offer full-strength build as an optional advanced setting after measuring load/performance. Full build packages are much larger. Multi-threaded builds require cross-origin isolation headers (`COOP`, `COEP`) and compatible asset hosting because of `SharedArrayBuffer`.

Example **UCI command sequence** (not the full production protocol implementation):

```js
const worker = new Worker('/engines/stockfish-19-lite-single.js');
worker.postMessage('uci');          // wait for uciok
worker.postMessage('setoption name MultiPV value 2');
worker.postMessage('isready');       // wait for readyok
worker.postMessage(`position fen ${fen}`);
worker.postMessage('go depth 18');
// Read info depth ... multipv ... score cp|mate ... pv ...
// Search is complete only when matching bestmove arrives.
```

Serve the corresponding `.wasm` alongside `.js` with correct MIME types and test in a production build, not only a dev server.

Build a robust `EngineClient` abstraction which:

- Serialises requests through **one worker** initially. Each UCI search has a unique app-side request ID and generation; no stale output should contaminate another position.
- Uses an explicit startup handshake (`uci`/`uciok`, `isready`/`readyok`), sets options only when safe, and handles `bestmove` as search completion.
- Parses `info depth`, `multipv`, `score cp`, `score mate`, optional `lowerbound`/`upperbound`, `pv`, nodes, elapsed time, and optional `wdl`.
- Builds a coherent snapshot per requested depth, only comparing MultiPV entries from the same depth when available; does not mistake a shallow/intermediate line for final output.
- Supports stop/cancel, timeout, crash recovery, engine reinitialisation and invalid FEN handling. A `stop` is asynchronous; **wait for the corresponding `bestmove` or restart the worker** before starting a new search.
- Throttles progress UI and avoids huge re-renders from streaming engine output.
- Exposes engine version/build, MultiPV setting, depth, nodes, and score perspective as metadata.
- Treats mate scores separately from centipawns, and does not turn mate scores into arbitrary enormous CP values.

**Critical UCI nuance:** MultiPV=2 returns two *candidate first moves*, not “best move and the actual move” unless the played move ranks in the top two. To assess an arbitrary played move, either (A) evaluate the `fenAfter` position with the side-to-move score correctly inverted or (B) run a **restricted-root search** from `fenBefore` using UCI `go ... searchmoves <playedUci>` and compare it against an equivalent search of the root. Choose and document one method; consider both for cross-validation. MultiPV ranking #6 requires evaluating enough candidate moves, not MultiPV=2.

## 6. Evaluation, centipawn loss and move labels

### Consistent score perspective

Choose **white-relative** as the canonical stored orientation: `positive = good for White`, `negative = good for Black`. Convert a UCI evaluation from *side to move* before storing (check engine-specific conventions). For classification, evaluate from the **player who made the move**; invert white-relative scores for Black. Scores before and after the played move **must share the same perspective**.

For mover-relative scores in the pre-move position:

```text
bestScore = score of best available move (pre-move root)
playedScore = score of actually played move (same root/perspective)
rawCentipawnLoss = max(0, bestScoreCp - playedScoreCp)
```

Equivalent after-position evaluations can be used if their semantics and search settings are carefully normalised. Clamp tiny negative differences due to search noise to zero. Depth, nodes, MultiPV and engine version influence scores. A root-vs-after comparison is useful but not an exact fixed-depth apples-to-apples calculation. Prefer comparing **expected game outcome / WDL changes** as an additional, often more stable severity signal. Do not call Stockfish's modern `cp=100` literally “one pawn of material”: modern engine values are normalised; material advantage is different from evaluation.

Checkmate and forced mate require special handling; handle terminal game positions, repetition, draw/stalemate and insufficient material. Do not fabricate centipawn loss when a mate score is involved.

### Initial classification logic (calibrate, do not pretend proprietary)

- **Best:** move is Stockfish's top choice or effectively tied with it within a documented tolerance.
- **Good:** slight evaluation/expected-outcome loss; no significant adverse effect.
- **Questionable / Inaccuracy:** noticeable loss, but not severe.
- **Mistake:** substantial loss; optionally separate between inaccuracy and blunder.
- **Blunder:** large loss, missed forced win, or allowed a decisive conversion/mate.
- **Brilliant (`!!`):** an independently validated high-depth quality move with **depth/rank reversal evidence**; see next section.

Set tentative numeric cut-offs behind a configurable, versioned classifier policy, then tune using annotated test positions and representative games. No exact numeric thresholds were agreed in the conversation. The user described labels as “best, good, questionable, blunder, brilliant”; an optional separate **Mistake** label and an **Inaccuracy** alias were also discussed. Move labels are a **priority decision tree**: first detect a valid brilliant, otherwise check best/good/inaccuracy/mistake/blunder based on loss. Never label a move brilliant if deep analysis finds it actually bad.

### Accuracy

The application should display a **clearly named proprietary-to-this-app accuracy estimate**, not claim to reproduce Chess.com's formula. Candidate approach: per-move quality derived from pre-move expected-score loss (WDL) or a calibrated smooth CP-loss transform, averaged across moves separately for White and Black and possibly weighted/adjusted for phase or position. Document and test the formula, avoid spurious 100% from a few moves, and mark incomplete analysis as **provisional**. If Chess.com supplies `accuracies`, show that only as separate provider data, never silently substitute it for ours.

## 7. Experimental original brilliant-move detector (`!!`)

**This is the project’s key differentiator. It is a research heuristic, not a proven definition of human brilliance.** Engine search depth does not directly measure human difficulty; pruning, horizons, tactical instability, caches and different MultiPV settings can cause reversals.

### Idea

A played move might look bad at shallow search, perhaps rank outside the best few moves, but become excellent after the engine calculates deep enough. A genuine brilliant candidate should also be very strong at final depth, ideally unique, potentially sacrificial, and robust on independent verification.

Example (all scores from the **mover's perspective**, hypothetical):

```text
Move: Rxf7!!
Depth  2: -2.8
Depth  3: -3.1
Depth  5: -1.5
Depth  8: +0.7
Depth 18: +4.2
Depth 28: +4.5
Depth inversion = +4.5 - (-3.1) = 7.6 evaluation pawns
```

Stronger hypothetical rank-reversal signal:

```text
Shallow search, depth 3: played move rank #6, score -2.3
Deep search, depth 28:    played move rank #1, score +3.8
Deep search, depth 28:    second-best score +0.6
```

The player’s **relative rank** at shallow depth matters: an apparent rise in score alone may reflect changes in the whole position, not a move that the shallow engine truly overlooked.

### Proposed signals

1. **Depth inversion**: `deepPlayedScore - shallowPlayedScore` from the same player's perspective, with consistent search protocols.
2. **Rank reversal**: e.g. shallow rank 6 → deep rank 1; may require MultiPV >2 or controlled root-search sampling at shallow depth.
3. **Deep quality**: played move must be best or near-best at high depth; reject if merely flashy but unsound.
4. **Uniqueness**: deep best minus deep second-best (in mover-relative terms). Large gap strengthens, but non-unique brilliant moves remain possible depending on policy.
5. **Discovery depth**: approximate depth where the move crosses from seemingly bad to reliably sound/good; smooth noisy scores and require sustained improvement, not one transient iteration.
6. **Sacrifice / temporary deficit**: optional bonus if material is genuinely and voluntarily sacrificed; **a capture, temporary material imbalance, or exchange alone is not proof**. Track material changes over a line, including forced recaptures and promotion.
7. **Robustness**: repeat or cross-check deep analysis with stable options, and avoid declaring brilliance if the result swings wildly between deep runs.

### Important measurement methodology

- A single `MultiPV=2` search is **not sufficient** to know that a played move was ranked #6. For meaningful shallow ranks, use MultiPV of enough moves (potentially all legal root moves for small tactical samples) **or** root-limited analyses of each relevant move.
- Record a trajectory for the **same played move** across depths, not whichever move is currently best at each depth. Otherwise the 'inversion' is meaningless.
- For `go searchmoves`, remember `searchmoves` belongs to the UCI `go` command; use the correct UCI move (promotion suffix included).
- Validate each deep result against the root-best and second-best at the **same** engine version/search budget/position. Consider node-budget controls in addition to depth when assessing reproducibility.
- Score oscillations, mate transitions, bound scores and late tactical discoveries make naïve `deep - shallow` unreliable: maintain a confidence/uncertain result.
- Depth 28 **is a target, not a guarantee**; position complexity, hardware and time vary. Do not promise low latency.

### Output should explain the classification

For every brilliant candidate, persist/display: move SAN/UCI, shallow rank and score, deep rank and score, best/second-best gap, discovery depth or interval, sacrifice evidence (if any), engine/version/settings, PV and confidence. A model such as `brillianceScore = f(inversion, uniqueness, rankReversal, discoveryDepth, sacrifice, stability)` is a starting point; define and test actual scales/weights before production use. Optionally display **“Brilliant candidate”** until enough confirmation exists.

### Prototype strategy

First implement a reproducible **single-position research screen/test harness** (input FEN and played UCI move, choose depths, collect all relevant scores). Use it to test curated tactical and quiet positions, obvious blunders, forced-only moves, alternative equally good sacrifices, mate-in-N and false shallow inversions. Only then roll this computation into whole-game analysis.

## 8. Analysis orchestration and performance

Suggested MVP strategy:

1. Parse game and create `N+1` positions.
2. Make a **fast first pass** (configurable e.g. depth 12–16) for each *pre-move* position, with `MultiPV=2` where practical, and make sure the played-move score is also measured or correctly estimated.
3. Determine move losses, provisional labels and provisional accuracy; render incremental progress.
4. Analyse **interesting positions** (large loss, unclear ranking, potential sacrifice/inversion, mate, tactical instability) more deeply at e.g. depth 18–22 in browser subject to device limits.
5. For brilliant candidates, sample a series of shallow depths and verify at larger depths, potentially via optional cloud jobs later.
6. Finish summaries only after required positions have final records. Allow user cancellation, resume, re-analysis at another preset, and caching.

Do **not** run all games' positions at depth 28 by default. Depth is not a fixed wall-clock limit. Expose a search time/node budget in addition to target depth for predictable UX. Consider total work estimates, concurrency cap (one local worker initially), tab-hidden throttling and memory usage. Engine warm cache can change trajectories; for the research detector consider controlled, reproducible engine state, and log whether engine hash was cleared.

Cache key must incorporate at least: canonical FEN (including relevant rule fields), engine identifier/build/version, NNUE network/build if applicable, search configuration (depth/nodes, MultiPV, Threads, Hash, searchmoves), score convention, and classifier version. Do not mix shallow lite results and deep full-engine results as if they came from identical conditions.

## 9. Proposed architecture and code layout

Keep ingestion, chess rules, engine transport, analysis logic, classification and UI independent:

```text
chess-analyser/
  README.md
  HANDOFF.md                      # copy this document here
  package.json
  src/
    app/                          # routes/layout and global UI state
    components/                   # board, move list, charts, selectors
    features/import/              # PGN import, Chess.com and Lichess adapters
    features/game/                # position navigation and presentation
    features/analysis/            # orchestrator, progress, cache
    core/chess/                   # chess.js adapter; PGN -> canonical moves/FEN
    core/engine/                  # Worker lifecycle, UCI parsing, types
    core/scoring/                 # perspective, CPL, WDL, accuracy
    core/classification/          # categories + versioned thresholds
    core/brilliancy/              # depth trajectory + experimental heuristic
    storage/                      # IndexedDB (when added)
    test/fixtures/                # PGN/FEN and mocked UCI transcripts
  public/engines/                 # bundled JS/WASM assets if needed
  docs/
    API_AND_FRESHNESS.md
    ALGORITHM_AND_TEST_CASES.md
    DECISIONS.md
```

Representative engine request/result contract (proposal):

```ts
type EngineScore =
  | { kind: 'cp'; value: number; perspective: 'white' }
  | { kind: 'mate'; moves: number; perspective: 'white' };

type EngineLine = {
  rank: number;                 // multipv number
  score: EngineScore;
  pvUci: string[];
  depth: number;
  nodes?: number;
  isBound?: boolean;
};

type PositionAnalysis = {
  fen: string;
  engineId: string;
  engineVersion: string;
  options: Record<string, unknown>;
  requestedDepth: number;
  completedDepth: number;
  lines: EngineLine[];
  completedAt: string;
};

type AnalysedMove = {
  move: MoveRecord;
  bestMoveUci?: string;
  scoreBest?: EngineScore;
  scorePlayed?: EngineScore;
  centipawnLoss?: number;
  category?: 'best' | 'good' | 'questionable' | 'mistake' | 'blunder' | 'brilliant';
  provisional: boolean;
  brillianceEvidence?: Record<string, unknown>;
};
```

Note: these are *domain models*, not necessarily exact API schemas. Use a discriminated score type to avoid mixing mate/cp and ensure scores are explicitly perspective-tagged.

### Advanced backend architecture (proposal)

Given a Python-friendly stack, **Django + Django REST Framework, PostgreSQL, Celery and a durable queue/broker** are a reasonable fit; alternatively FastAPI with equivalent robust job orchestration if requirements justify it. Use native Stockfish subprocesses in sandboxed worker containers, with CPU/memory/time limits; GPUs are generally not the first route for standard Stockfish search.

Entities: `User`, `ExternalAccount`, `Game`, `Move`, `AnalysisRun`, `PositionAnalysis`, `MoveClassification`, `SyncCursor`, `AnalysisJob` and possibly `UserGameSummary`. Uniqueness: source+game URL or other stable ID, dedupe multiple imports of the same game, independent engine-analysis keys. Store raw PGN and provenance; don't overwrite old engine evaluations in-place when settings change.

Conceptual backend routes (later, not MVP):

```text
POST /api/imports/chesscom/           { username, months? }
POST /api/imports/lichess/            { username, since?, max? } | { gameUrlOrId }
POST /api/imports/pgn/                upload/paste PGN
GET  /api/games/                      filters and pagination
GET  /api/games/:id/
GET  /api/games/:id/analysis/
POST /api/games/:id/analyse/          { profile: "deep" }
GET  /api/analysis-jobs/:id/
POST /api/analysis-jobs/:id/cancel/
GET  /api/stats/                     user dashboard
```

For phase 2, secure user/private data, rate-limit costly endpoints, avoid SSRF through arbitrary URL fetches, and use explicit allowlists for any external URL importer. Track sync lag and failures. A cloud analysis worker should report achieved depth, nodes, duration, engine version, and cost/resource usage, not just a requested depth number.

## 10. Acceptance criteria and tests

**Importer**

- A valid single-game PGN reconstructs the correct initial position, each move and final position; multi-game PGN yields distinct games.
- Valid PGNs including castling, en passant, promotion, comments and `SetUp/FEN` pass. Invalid PGNs show actionable errors.
- Chess.com archive URL builder uses `YYYY/MM` correctly; latest game uses max `end_time`; absence of newest game is explained as publication lag.
- Mock `429`, `304`, empty archive, partial/missing fields and network/CORS failures.
- `tcn` is tolerated and not required; no unverified game-URL extraction is silently relied upon.
- Lichess: game URL/ID parsing (8-char, 12-char, `/white`/`/black` suffixes, wrong host rejected); NDJSON stream parsing including a partial last line; unfinished games and non-standard variants skipped; `429` triggers a ≥60 s back-off; requests are serialised.

**Engine**

- Worker initialises and analyses a known FEN; main-thread input remains responsive.
- UCI handshake, MultiPV parsing, `bestmove`, `mate`, score bounds, interrupted searches and stale-generation suppression are tested using mocked UCI transcripts.
- Same-depth MultiPV lines are matched correctly; a played move outside MultiPV top 2 is still scored.
- Score sign tests for both White and Black: a strong move must not be called a blunder because the side-to-move flipped.

**Classification and accuracy**

- A clearly bad move gets positive CPL and an adverse category; best move gets near-zero loss.
- Mate-in/mated-in and drawn terminal positions behave without fake enormous CPL.
- Aggregate accuracy is reproducible for a fixed classifier version, and provisional until complete.
- Cases with multiple nearly equivalent best moves do not trigger false uniqueness or unsupported rank claims.

**Brilliancy heuristic**

- Deeply refuted sacrifice is NOT brilliant despite initial appearance.
- Shallow-to-deep apparent reversal is recognised and explained only when deep soundness is confirmed.
- No false rank-6 claims from MultiPV=2; scores are all from the mover's perspective and tracked for the same move.
- Discovery depth is an interval/estimate; noisy oscillations do not automatically qualify.
- Regression fixtures include known tactical studies and quiet move controls; do not guarantee that famous `!!` annotations must agree with this original heuristic.

**UX**

- Import a real or fixture PGN, navigate board, start/cancel engine review, inspect all move labels, and see incomplete results clearly.
- No browser freeze; loading large WASM reports progress or clear loading status.
- A fully analysed game displays two separate players' summaries and a configurable accuracy score.

## 11. Suggested build order for the agent

1. **Inspect folder**, existing code, package manager and repository conventions. Do not delete existing work.
2. Scaffold React/TypeScript/Vite if needed; create project README, scripts for `dev`, `build`, `test`, `lint`.
3. Implement PGN parser, canonical `GameRecord`/`MoveRecord`, and fixtures/tests.
4. Build board/game navigation UI with a sample PGN; get play-through correct before adding engine.
5. Integrate WASM Stockfish in a Worker, with lifecycle and transcript unit tests.
6. Build one-FEN analysis view with score, best move, second-best PV, depth and cancel.
7. Build per-ply game analysis orchestration, played-move evaluation and classifier.
8. Build accurate score perspective normalization and regression cases for Black moves.
9. Add Chess.com username/month import and clear current-month freshness messaging; add Lichess username and game-URL import; **spike CORS for both providers first**.
10. Compute game-level statistics and own accuracy method; add progress/resume or reanalyse.
11. Implement research harness for depth inversion/unique-move discovery; tune against curated FENs, then add provisional `!!`.
12. Add caching, chart, export and full QA; then revisit backend/cloud phases.

Avoid premature architecture for cloud compute until the local proof of concept and benchmark data are available.

## 12. Open questions to decide through implementation and experiments

- Is a small server proxy necessary for Chess.com or Lichess CORS? Verify first with a minimal deployed client.
- Which Stockfish build/version is the default (lite for low-bandwidth vs full for reliability of evaluations)? How to deal with cross-origin isolation?
- What are the reasonable time/node budgets on mobile, desktop and low-power browsers?
- Should 'Questionable' mean 'Inaccuracy', or be kept as a user-facing alias with a distinct 'Mistake' tier?
- What exact (versioned) accuracy formula and cut-offs should be used, and how should drawn/forced positions contribute?
- For brilliant candidates: is deep search of one line enough, or are repeated/alternate-root comparisons required? What weights and confidence thresholds work on a validation dataset?
- Should immediate finished-game URL import ever be supported, and through which documented, compliant mechanism?
- When backend arrives, decide authentication, privacy model, batch sync cadence and cloud-cost budget.

These questions should **not block the first usable PGN-to-board-to-Stockfish vertical slice**.

## 13. Compliance, licensing and source references

- Lichess's API is open, but clients must respect its rate limits (one request at a time, back off on `429`). Show a non-affiliation disclaimer for Lichess too.
- Chess.com PubAPI is for public read-only access. **Chess.com requires clear non-affiliation disclosure**, and its API guidance warns against copying its protected chessboard design, chess pieces, sound effects, move-classification glyphs/visual treatment, branded features and other IP. Build independent visuals and an original classifier; include a visible disclaimer.
- Stockfish.js's packaged engine is **GPL-3.0**. Check the licence obligations for the exact distributable and hosting setup; preserve notices and make required corresponding source available. Board component and parser licences should also be reviewed.
- Don't route finished-game analysis into ongoing games or offer cheating assistance.
- Treat all third-party PGN, headers, usernames, URLs and API strings as untrusted input; escape output and avoid unsafe HTML injection. Put size, time, concurrency and storage caps in place.

References checked 8 Nov 2026:

1. Chess.com official PubAPI guidance, cache, rate limits and IP requirements: https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it
2. Chess.com official PGN-download instructions: https://support.chess.com/en/articles/8705305-how-do-i-get-a-pgn-of-my-game
3. Chess.com published API reference: https://www.chess.com/news/view/published-data-api
4. Stockfish.js repo and WASM-worker guidance: https://github.com/nmrugg/stockfish.js
5. Stockfish npm WASM package: https://www.npmjs.com/package/stockfish
6. UCI engine protocol: https://github.com/fsmosca/UCIChessEngineProtocol
7. Stockfish evaluation/WDL FAQ: https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html
8. chess.js docs: https://github.com/jhlywa/chess.js
9. React chessboard library: https://github.com/Clariity/react-chessboard
10. Lichess API reference (game export, rate limits): https://lichess.org/api

**Important verification limit:** The exact `example_player` archive data was **not fetched live** during preparation; the links above follow Chess.com's documented URL patterns. The browser-only cross-origin behaviour and immediate game-URL extraction path remain explicitly unverified.

---

## 14. Copy/paste launch prompt for a new coding agent

> Read `CHESS_ANALYSER_HANDOFF.md` completely. Inspect the repository and identify what already exists. Implement **Phase 1 MVP** incrementally, beginning with a fully testable PGN parsing + board-navigation vertical slice and then a Web Worker Stockfish integration. Use the handoff’s architecture, score-perspective correctness requirements, freshness constraints and tests. Avoid assuming that Chess.com game URLs offer instant official PGN retrieval (Lichess game URLs do, via the official export endpoint), and verify browser CORS for both providers before relying on client-only import. Treat the depth-inversion brilliant detector as an experimental, explainable subsystem—not as a shortcut to ordinary best-move classification. Keep the project runnable after each milestone, add tests, and document all deviations and unresolved findings in `docs/DECISIONS.md`.
