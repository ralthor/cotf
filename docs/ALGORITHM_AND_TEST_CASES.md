# Algorithms and test cases

Implementations: TypeScript in `web/src/core/*`, Python port in `backend/analysis/scoring.py` and `backend/cloud/brilliancy.py`. Version strings: `cls-v1`, `acc-v1`, `brill-v2`. Change a version whenever behaviour changes.

## Review pipeline (browser `GameAnalyser`, cloud `CloudGameAnalyser`)

1. **First pass.** Every position 0..N is searched at the preset's first-pass depth with MultiPV 2. For each ply, the played move is scored from the root line if it is in the top 2, otherwise by a `searchmoves` search at the same depth. Labels and accuracy update as each position finishes.
2. **Deep pass.** Moves labelled inaccuracy/mistake/blunder, moves involving mate scores, and moves within 1.5 points of the good/inaccuracy boundary are searched again at the deep depth and re-labelled.
3. **Brilliancy pass.** For up to N candidates, `collectBrillianceInput` gathers the evidence, `evaluateBrilliance` scores it, and the move is re-labelled.
4. Engine results are cached in IndexedDB. The key covers the canonical FEN, engine build, depth/nodes/movetime, MultiPV, searchmoves, hash-clearing and score convention. Re-running a cancelled analysis resumes from the cache.

## Perspective

- Stored scores are white-relative. A score is converted to the mover's view only to compare it. `moveLoss` uses the mover's view for both the best and the played score.
- Mate scores never become centipawns: CPL is `undefined` when either score is a mate. Expected score saturates at 0 or 1.

## Test inventory

| Area | Where | What it covers |
| --- | --- | --- |
| PGN | `web/src/core/chess/pgn.test.ts`, `backend/tests/test_games.py` | multi-game split, CRLF/BOM, castling, en passant, SetUp/FEN + promotion, NAGs/variations/comments, clocks, illegal move, Chess960 rejected, size guard, stable IDs |
| UCI | `web/src/core/engine/engine.test.ts` | info parsing (multipv, cp, mate, bounds, wdl), bestmove `(none)`, `go … searchmoves`, handshake, same-depth MultiPV, request serialisation, cancel → stop → bestmove, restart on unacknowledged stop, invalid FEN, checkmate/stalemate |
| Perspective & labels | `classify.test.ts`, `shared/classifier-cases.json` (both languages) | Black-move sign handling, tiers, ties, forced moves, allowed mate, missed mate, slower mate, brilliant only if best |
| Accuracy | `classify.test.ts`, `test_scoring.py` | monotonic, ≥ 5 moves, provisional, forced moves ignored, reference value 80.6 |
| Brilliancy | `brilliancy.test.ts`, `test_brilliancy.py` | looks like a mistake within the 3-ply horizon but decisive best → brilliant; low rank in an already-winning position → none; obvious move → none; refuted sacrifice → none; found within the horizon → none; 1-ply horizon (Qb8+); no recheck → candidate; unstable recheck → none; Black perspective; ordinals; sacrifice vs. exchange |
| Orchestration | `orchestrator.test.ts` (2-ply material fake engine) | hanging queen → blunder / capture → best, searchmoves fallback, cache resume, cancel |
| Import | `import.test.ts`, `test_games.py` | URL builders, UTC month, 429/304, CORS failure message, missing fields, `tcn` tolerated, NDJSON streaming and truncation, unfinished/variant filtering, 60 s Lichess back-off, serialised requests, ETag sync, completed months skipped |
| Export & storage | `export.test.ts` | annotated PGN round-trips; IndexedDB stores games, analyses and engine results |
| Backend API | `test_accounts.py`, `test_analysis_and_cloud.py` | auth, isolation between users, upload re-classification, immutable runs, stats, native runner (fake UCI), end-to-end cloud job, quota/dedupe/cancel |

## Curated positions still to collect (calibration set)

- Known tactical studies with accepted `!!` moves (positive class), including quiet-move brilliancies with no material sacrifice.
- Flashy but refuted sacrifices (negative class).
- Only-moves in defence (unique but obvious, which should usually stay "best").
- Mate-in-N where the engine finds the mate at depth 1–3 (should not be brilliant).
- Positions with several equal sacrifices (uniqueness should be low).
