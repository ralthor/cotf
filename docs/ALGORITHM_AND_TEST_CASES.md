# Algorithms and test cases

Implementations: TypeScript in `web/src/core/*`, Python port in `backend/analysis/scoring.py` and `backend/cloud/brilliancy.py`. Version strings: `cls-v1`, `acc-v1`, `brill-v3`, `great-v1` (browser only for now). Change a version whenever behaviour changes.

## Review pipeline (browser `GameAnalyser`, cloud `CloudGameAnalyser`)

1. **First pass.** Every position 0..N is searched at the preset's first-pass depth with MultiPV 2. For each ply, the played move is scored from the root line if it is in the top 2, otherwise by a `searchmoves` search at the same depth. Labels and accuracy update as each position finishes.
2. **Deep pass.** Moves labelled inaccuracy/mistake/blunder, moves involving mate scores, and moves within 1.5 points of the good/inaccuracy boundary are searched again at the deep depth and re-labelled.
3. **Brilliant/great pass.** Candidates are the brilliancy shortlist plus a great-move shortlist (moves rated best whose first-pass lead over the other line is ≥ 60% of the great threshold at full depth and not clearly ahead at the shallow horizon). For each one, `collectBrillianceInput` gathers the evidence once, `evaluateBrilliance` and `evaluateGreat` both read it, and the move is re-labelled. Priority: brilliant → great → best.

### Great moves (`great-v1`, `web/src/core/brilliancy/great.ts`)

All gates must pass (expected-score points, mover's view):

| Gate | Rule |
| --- | --- |
| has-alternatives | at least 2 legal moves |
| best-at-depth | best or within 1.5 of best at the brilliancy deep depth, and ≥ 30% expected score |
| far-better-at-depth | leads the next move by ≥ 12 |
| ambiguous-at-shallow-depth | at the horizon (default 3 plies) it leads the best other move by < 4, or trails it |
| stable-on-recheck | still best on the deeper recheck, lead ≥ 8 |

An obvious recapture fails the shallow gate (it already leads by a lot at 1 ply), so it stays "best".
4. Engine results are cached in IndexedDB. The key covers the canonical FEN, engine build, depth/nodes/movetime, MultiPV, searchmoves, hash-clearing and score convention. Re-running a cancelled analysis resumes from the cache.

## Why was this move bad? (`why-v1`, on demand, `web/src/core/explain/whyBad.ts`)

Runs only when asked, for one inaccuracy/mistake/blunder, and never changes the game analysis. Three searches at the preset's deep depth (through the same engine-result cache): MultiPV 3 from the position before the move, the played move alone (`searchmoves`), and a **threat search**: the same position with the opponent to move (a "null move": side flipped, en passant cleared; not possible in check).

- **Threat:** the opponent's best move after the pass. It is *real* when passing costs ≥ 8 points and it is concrete (a capture, a check, or a line that mates or wins ≥ 1 pawn). With ≤ 2 pieces left it is marked low-confidence (zugzwang).
- **Causes** (several can apply):
  - *Ignored a threat:* a real threat, and the opponent's reply to the move is that threat (same move, same target square, or the same mate), or the move ends up within 3 points of passing.
  - *Missed the only good move:* the best move leads the second-best by ≥ 12 points (the great-move gap).
  - *Missed an opportunity:* no ignored threat, and the best line mates or wins ≥ 2 pawns, ≥ 2 more than the played line.
  - *Allowed a tactic:* no ignored threat, and the played line loses ≥ 2 pawns, both outright and compared with the best line, or gets mated.
  - *Positional:* none of the above.
- Material is counted after the opponent's reply (an even ply, ≤ 6) and never in the middle of an exchange (following captures are included).
- **Several threats:** the threat search uses MultiPV 3; every real line is a threat (up to 3), and the played move is checked against each.
- **Show threat** works on any position: the same threat search, with red arrows on the board.

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
| Brilliancy | `brilliancy.test.ts`, `test_brilliancy.py` | looks like a mistake within the 3-ply horizon but decisive best → brilliant; low rank in an already-winning position → none; obvious move → none; refuted sacrifice → none; found within the horizon → none; 1-ply horizon (Qb8+); no recheck → candidate; unstable recheck → none; Black perspective; ordinals; sacrifice vs. exchange; v3: queen sac + mate in one (1-ply horizon) → brilliant; same quick payoff without a sacrifice or with a rook → none; hanging queen passes looks-bad; queen-trade offer is not a sacrifice; quiet move leaving a piece hanging is a sacrifice; sacrifice bonus scales with size |
| Great moves | `great.test.ts`, `classify.test.ts` | hidden decisive move → great; obvious recapture → none; small deep lead → none; not best → none; already-won position (saturation) → none; only drawing defence → great; lost position → none; recheck required; Black perspective; forced → none; brilliant outranks great; great requires best |
| Why bad / threats | `whyBad.test.ts`, `explainer.test.ts` | null move (flip, en passant, in check); exchange-safe material count; ignored threat (White and Black); allowed tactic; missed opportunity + only move; shared capture is no opportunity; unstoppable mate is not ignored; positional; in check; quiet move is no threat; one-pawn threat counts; threat handled; hanging queen with a pawn threat → allowed tactic (material engine) |
| Orchestration | `orchestrator.test.ts` (2-ply material fake engine) | hanging queen → blunder / capture → best, searchmoves fallback, cache resume, cancel |
| Import | `import.test.ts`, `test_games.py` | URL builders, UTC month, 429/304, CORS failure message, missing fields, `tcn` tolerated, NDJSON streaming and truncation, unfinished/variant filtering, 60 s Lichess back-off, serialised requests, ETag sync, completed months skipped |
| Export & storage | `export.test.ts` | annotated PGN round-trips; IndexedDB stores games, analyses and engine results |
| Backend API | `test_accounts.py`, `test_analysis_and_cloud.py` | auth, isolation between users, upload re-classification, immutable runs, stats, native runner (fake UCI), end-to-end cloud job, quota/dedupe/cancel |

## Curated positions still to collect (calibration set)

- Known tactical studies with accepted `!!` moves (positive class), including quiet-move brilliancies with no material sacrifice.
- Flashy but refuted sacrifices (negative class).
- Only-moves in defence (unique but obvious, which should usually stay "best").
- Mate-in-N where the engine finds the mate at depth 1–3: not brilliant, unless it starts with a queen-sized sacrifice (v3).
- Positions with several equal sacrifices (uniqueness should be low).
- Great moves: quiet only-moves that keep the advantage, only drawing defences, and obvious recaptures (negative class), to tune the 12 / 4 point thresholds.
