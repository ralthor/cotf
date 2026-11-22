# Opening trainer, phase 9: where your games went wrong, and training the fixes

Status: implemented, 21 Nov 2026; win chances from the engine here or the database since 22 Nov 2026. Builds on [phase 8](OPENING_TRAINER_PHASE8.md); the overall plan is in
[OPENING_TRAINER.md](OPENING_TRAINER.md).

## Why

Phase 8 ranks positions by results. A game lost in the opening but won later counts as a good line, and
a line played once never shows, so games you felt you lost in the opening were missing. You could see the
games behind a number but not play through one with what went wrong, what the best move was, and what
the database plays. And the findings could not be trained.

## Scope

1. **Lost in the opening** (a third list in Improve, the default): each recent game with the move where
   your win chances dropped most in the opening.
   - Sortable columns: date, opponent and rating, result, the move (with ?!, ?, ??), your win chances
     before → after (and the evaluations), the drop, the best move, your win chances when the opening
     ended, and **Not a problem**.
   - Under each row, one plain sentence saying the same.
   - Filters: last 50 / 100 / 200 / 500 / all games; at least an inaccuracy, a mistake or a blunder;
     only games you did not win. Colour, time control and "up to move" are shared with the other lists.
2. **Game player**: any row (and **Play** in every games list) opens the game at the move.
   - Board with three arrows: the move played (blue), the engine's move (green), the database's
     best-scoring main move (orange).
   - The evaluation and your win chances before and after the move, the drop and its label, the engine's
     line, and the database's moves with games, share and score.
   - An evaluation chart over the opening with your mistakes marked; the whole game's moves, with the
     measured ones marked; arrow keys step through.
   - **This move in the game on Lichess** (Lichess games) or **This position on Lichess**, and **Analyse
     from here**, which opens the game in the Analyse tab at that move.
3. **Better moves**, clearer: separate sortable columns for your move and how often you played it, your
   own score with it, how often you lost with it, its database score, the better move, its database
   score, the gain, the points to gain, and the engine's view (evaluation after your move → after the
   better one). A sentence under each row explains it; **Not a problem** hides it.
4. **My fixes**: **Train … in My fixes** (in the player and in a position's suggestions) adds a chapter
   to a repertoire called My fixes. The chapter starts at the position, not at move 1. It holds the
   better move, then the opponent's likely replies from the database (up to 3, each at least 10% of
   games), your best-scoring main reply to each, and up to 2 replies after that. The trainer shows how
   your games reached the position (without the answer); the reason for the move is shown after you
   answer. **Train My fixes** opens the Train sub-tab on it, with the usual spaced repetition.
5. **Not a problem** hides a finding in both lists; hidden ones can be shown and brought back.

## Win chances: the engine here, or the database

You pick the source above the list. Lichess's analysis servers are not used.

- **Engine on this device**: Stockfish in the browser analyses every position of each game's opening, at
  a depth you pick: quick (10), normal (14) or deep (18). Win chances use the Lichess formula, so −10%,
  −20%, −30% are what Lichess calls an inaccuracy, a mistake and a blunder. Results are kept per position
  and depth, so a position is analysed once. Measured: 50 games (1,344 positions) at depth 10 in under 20 s.
- **Opening database**: how players actually scored, from the Lichess players database (token) or the
  masters database. Before your move: the position's results. After it: the games where your move was
  played there; the position's own results only when your move is too rare there. A value needs at
  least 50 games. Lookups are paced (one every 1.1 s, a minute's wait on "too many requests").
  The list can also show drops from −5%, since the database's drops are smaller than the engine's.

The game player analyses the position it stops on with the engine (after a short pause), whatever the
source, so the engine's move is always there; with the database source it also shows the database's
value before and after the move.

## Storage

- IndexedDB version 7: `engineEvals` (`position key|depth` → score, depth, line). Version 6's
  `cloudEvals` (the first version, with Lichess cloud evaluations) is dropped.
- Preferences: `insightsHidden` (hidden findings), `fixesRepertoire` (the My fixes repertoire),
  `insightsList` (the list shown), `lossSource` and `lossDepth`; the losses filters join `insightsFilters`.

## Files

- `core/repertoire/openingLoss.ts`: win chances from the engine or the database, drops, the worst move,
  the database positions to ask for. Pure, tested.
- `features/repertoire/paced.ts`: paced database requests with the 429 wait.
- `features/repertoire/useOpeningLosses.ts`: the source, the engine scan (over the engine pool) and the
  database scan, with results kept in IndexedDB.
- `features/repertoire/GamePlayer.tsx`: the game player.
- `features/repertoire/fixes.ts`: building a My fixes chapter (replies from the database, PGN).

## Not in this phase

- Replaying the moves before a fix's position on the training board (the trainer shows them as text).
- Uploading a game to Lichess for a new analysis (the links open Lichess's own pages).
- Mixing the two sources in one list.
- Opponents' mistakes in the opening (only your moves are measured).
