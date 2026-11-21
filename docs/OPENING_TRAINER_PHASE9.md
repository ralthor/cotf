# Opening trainer, phase 9: where your games went wrong, and training the fixes

Status: implemented, 21 Nov 2026. Builds on [phase 8](OPENING_TRAINER_PHASE8.md); the overall plan is in
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

## Evaluations: Lichess, not an engine here

No engine runs on the device.

- **Lichess games you had analysed there** carry their evaluations in the PGN (`[%eval]`). Games are now
  fetched with `evals=true`; for these no request is needed.
- **Everything else** uses Lichess cloud evaluations (`/api/cloud-eval`), open, no token, with CORS.
  Checked on 21 Nov 2026: two typical lines had evaluations at 24 of 24 and 20 of 22 positions.
  Positions Lichess has not analysed stay without one; they are asked again after 30 days.
- Win chances use the Lichess formula (the same logistic as the rest of the app), so −10%, −20%, −30%
  are what Lichess calls an inaccuracy, a mistake and a blunder.

The Lichess opening explorer itself has no evaluations, only move statistics; those stay the database
side.

## Rules

- A first pass asks for the position before your first move and the position after each of your moves,
  up to the "up to move" limit. A drop between two of them covers your move and the opponent's reply
  before it.
- Then, for each game's worst move, the position right before it is asked for: that makes the drop exact
  and gives the best move. Up to three rounds, since the worst move can change once measured exactly.
  The sentence says when a drop could not be measured exactly.
- Requests are paced at one every 1.1 s with a one-minute wait on "too many requests", and each position
  is asked once and kept. Positions shared by many games are asked once.
- The game player looks up the position it stops on (after a short pause), not paced, since it is one
  position at a time.

## Storage

- IndexedDB version 6: `cloudEvals` (position key → evaluation or "not analysed", and the date).
- Preferences: `insightsHidden` (hidden findings), `fixesRepertoire` (the My fixes repertoire),
  `insightsList` (the list shown); the losses filters join `insightsFilters`.

## Files

- `core/repertoire/openingLoss.ts`: win chances, drops, the worst move, the plies to ask for. Pure, tested.
- `features/repertoire/cloudEval.ts`: the cloud evaluation client (castling written as e1g1).
- `features/repertoire/paced.ts`: paced requests with the 429 wait.
- `features/repertoire/useOpeningLosses.ts`: the scan and the evaluations kept in IndexedDB.
- `features/repertoire/GamePlayer.tsx`: the game player.
- `features/repertoire/fixes.ts`: building a My fixes chapter (replies from the database, PGN).

## Not in this phase

- Replaying the moves before a fix's position on the training board (the trainer shows them as text).
- Uploading a game to Lichess for a new analysis (the links open Lichess's own pages).
- Opponents' mistakes in the opening (only your moves are measured).
